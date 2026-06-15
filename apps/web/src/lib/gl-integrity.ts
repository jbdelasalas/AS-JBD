import { type PoolClient } from 'pg';

/**
 * GL integrity helpers — the controls an accountant/auditor relies on.
 *
 * These run INSIDE the caller's transaction (they take a PoolClient, never the
 * pool). If any of them throws, the caller's BEGIN/COMMIT must roll back so the
 * financial action and its audit trail commit or fail together.
 */

const PENNY = 0.005; // tolerance for rounding noise in PHP centavos

export class GLIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GLIntegrityError';
  }
}

/**
 * (Item 4) Assert a journal entry's lines balance before it is treated as
 * posted. Auto-generated JEs (AR/AP/sales) were posting without this check and
 * silently plugging gaps; a misconfigured VAT or revenue account could produce
 * a lopsided entry. Call this after inserting all lines, before COMMIT.
 *
 * Throws GLIntegrityError if SUM(debit) != SUM(credit) or the entry is empty.
 */
export async function assertEntryBalanced(
  client: PoolClient,
  entryId: string,
): Promise<{ debit: number; credit: number }> {
  const res = await client.query(
    `SELECT COALESCE(SUM(debit), 0)  AS d,
            COALESCE(SUM(credit), 0) AS c
       FROM journal_entry_lines
      WHERE entry_id = $1`,
    [entryId],
  );
  const debit = Number(res.rows[0].d);
  const credit = Number(res.rows[0].c);

  if (debit === 0 && credit === 0) {
    throw new GLIntegrityError(
      `Refusing to post journal entry ${entryId}: it has no lines / zero amount.`,
    );
  }
  if (Math.abs(debit - credit) > PENNY) {
    throw new GLIntegrityError(
      `Refusing to post unbalanced journal entry ${entryId}: ` +
        `debit ${debit.toFixed(2)} != credit ${credit.toFixed(2)} ` +
        `(difference ${(debit - credit).toFixed(2)}). ` +
        `Check that revenue, VAT, and control accounts are configured correctly.`,
    );
  }
  return { debit, credit };
}

/**
 * (Item 2) Transactional audit log. Unlike the legacy `INSERT ... .catch(() =>
 * {})` pattern scattered across the routes, this runs in the caller's
 * transaction and is allowed to fail the whole operation: an audit trail that
 * can silently disappear is not an audit trail.
 *
 * Captures before/after state so "who changed what, from what, to what" is
 * always answerable.
 */
export async function writeAuditLog(
  client: PoolClient,
  entry: {
    userId: string | null;
    companyId: string | null;
    action: string; // post | void | update | delete | approve | ...
    entityType: string; // journal_entry | sales_invoice | ...
    entityId: string | null;
    beforeState?: unknown;
    afterState?: unknown;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (user_id, company_id, action, entity_type, entity_id,
        before_state, after_state, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.userId,
      entry.companyId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.beforeState === undefined ? null : JSON.stringify(entry.beforeState),
      entry.afterState === undefined ? null : JSON.stringify(entry.afterState),
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  );
}

export interface BalanceDrift {
  account_id: string;
  account_code: string;
  account_name: string;
  fiscal_period_id: string;
  cached_debit: number;
  cached_credit: number;
  ledger_debit: number;
  ledger_credit: number;
  debit_drift: number;
  credit_drift: number;
}

/**
 * (Item 3) Reconcile the denormalized `account_balances` cache against the
 * source of truth (posted journal_entry_lines). Any row returned is a place
 * where a report could disagree with the ledger — the kind of silent drift the
 * void/post paths can introduce. A trustworthy system audits itself; an empty
 * result is the proof.
 */
export async function reconcileAccountBalances(
  client: PoolClient,
  companyId: string,
): Promise<BalanceDrift[]> {
  const res = await client.query(
    `WITH ledger AS (
       SELECT jel.account_id,
              je.fiscal_period_id,
              SUM(jel.debit)  AS ledger_debit,
              SUM(jel.credit) AS ledger_credit
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.entry_id
        WHERE je.status = 'posted'
          AND je.company_id = $1
        GROUP BY jel.account_id, je.fiscal_period_id
     )
     SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name,
            COALESCE(ab.fiscal_period_id, l.fiscal_period_id) AS fiscal_period_id,
            COALESCE(ab.debit_total, 0)::float  AS cached_debit,
            COALESCE(ab.credit_total, 0)::float AS cached_credit,
            COALESCE(l.ledger_debit, 0)::float  AS ledger_debit,
            COALESCE(l.ledger_credit, 0)::float AS ledger_credit,
            (COALESCE(ab.debit_total, 0)  - COALESCE(l.ledger_debit, 0))::float  AS debit_drift,
            (COALESCE(ab.credit_total, 0) - COALESCE(l.ledger_credit, 0))::float AS credit_drift
       FROM accounts a
       JOIN ledger l ON l.account_id = a.id
       FULL OUTER JOIN account_balances ab
            ON ab.account_id = l.account_id
           AND ab.fiscal_period_id = l.fiscal_period_id
      WHERE a.company_id = $1
        AND (ABS(COALESCE(ab.debit_total, 0)  - COALESCE(l.ledger_debit, 0))  > ${PENNY}
          OR ABS(COALESCE(ab.credit_total, 0) - COALESCE(l.ledger_credit, 0)) > ${PENNY})
      ORDER BY a.code`,
    [companyId],
  );
  return res.rows as BalanceDrift[];
}
