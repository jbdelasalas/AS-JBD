import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CreateJournalEntryDto, JournalEntry, JournalEntryStatus } from '@perpet/shared';

import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class JournalEntriesService {
  private readonly logger = new Logger('JournalEntries');

  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async create(companyId: string, dto: CreateJournalEntryDto, userId: string): Promise<JournalEntry> {
    if (!dto.lines || dto.lines.length < 2) {
      throw new BadRequestException('A journal entry must have at least two lines');
    }

    // Normalise debit/credit to numbers and validate per-line
    const lines = dto.lines.map((l, idx) => {
      const debit = Number(l.debit ?? 0);
      const credit = Number(l.credit ?? 0);
      if (debit < 0 || credit < 0) {
        throw new BadRequestException(`Line ${idx + 1}: debit and credit must be non-negative`);
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new BadRequestException(
          `Line ${idx + 1}: each line must have either a debit or a credit, not both and not neither`,
        );
      }
      return { ...l, debit, credit };
    });

    // Validate balanced (use 4-decimal tolerance to avoid float drift)
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException(
        `Journal entry is unbalanced. Debit: ${totalDebit.toFixed(2)} Credit: ${totalCredit.toFixed(2)}`,
      );
    }

    // Validate fiscal period is open
    const period = await this.findFiscalPeriod(companyId, dto.entry_date);
    if (!period) {
      throw new BadRequestException(`No fiscal period defined for ${dto.entry_date}`);
    }
    if (period.status === 'closed') {
      throw new BadRequestException(`Fiscal period for ${dto.entry_date} is closed`);
    }

    // Validate all accounts belong to the company and are active
    const accountIds = [...new Set(lines.map((l) => l.account_id))];
    const accountRows = await this.ds.query(
      `SELECT id, code, name, is_active FROM accounts WHERE id = ANY($1) AND company_id = $2`,
      [accountIds, companyId],
    );
    if (accountRows.length !== accountIds.length) {
      throw new BadRequestException('One or more accounts not found in this company');
    }
    const inactive = accountRows.filter((a: { is_active: boolean }) => !a.is_active);
    if (inactive.length) {
      throw new BadRequestException(
        `Inactive accounts cannot be used: ${inactive.map((a: { code: string }) => a.code).join(', ')}`,
      );
    }

    return this.ds.transaction(async (tx) => {
      // Issue next entry number from document_series
      const entryNo = await this.nextDocumentNumber(tx, companyId, 'journal_voucher');

      // Insert header
      const headerRows = await tx.query(
        `INSERT INTO journal_entries
           (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo, source_module, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', 'draft', $8)
         RETURNING *`,
        [
          companyId,
          dto.branch_id ?? null,
          entryNo,
          dto.entry_date,
          period.id,
          dto.reference ?? null,
          dto.memo ?? null,
          userId,
        ],
      );
      const header = headerRows[0];

      // Insert lines
      const inserted: unknown[] = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const r = await tx.query(
          `INSERT INTO journal_entry_lines
             (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1, $2, $3, $4, $5, $6, 'PHP', 1, $5, $6)
           RETURNING *`,
          [header.id, i + 1, l.account_id, l.description ?? null, l.debit, l.credit],
        );
        inserted.push(r[0]);
      }

      await this.audit.record({
        userId,
        companyId,
        action: 'create',
        entityType: 'journal_entry',
        entityId: header.id,
        afterState: { ...header, lines: inserted },
      });

      return this.findById(header.id);
    });
  }

  async findById(id: string): Promise<JournalEntry> {
    const headers = await this.ds.query(
      `SELECT je.*, fp.year AS period_year, fp.period AS period_number
         FROM journal_entries je
         LEFT JOIN fiscal_periods fp ON fp.id = je.fiscal_period_id
        WHERE je.id = $1 LIMIT 1`,
      [id],
    );
    const header = headers[0];
    if (!header) throw new NotFoundException(`Journal entry ${id} not found`);

    const lines = await this.ds.query(
      `SELECT jel.*, a.code AS account_code, a.name AS account_name
         FROM journal_entry_lines jel
         JOIN accounts a ON a.id = jel.account_id
        WHERE jel.entry_id = $1
        ORDER BY jel.line_no`,
      [id],
    );

    return {
      ...header,
      lines: lines.map((l: Record<string, unknown>) => ({
        ...l,
        debit: Number(l.debit),
        credit: Number(l.credit),
      })),
    };
  }

  async list(companyId: string, opts: { status?: JournalEntryStatus; limit?: number; offset?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `je.company_id = $1`;
    if (opts.status) {
      params.push(opts.status);
      where += ` AND je.status = $${params.length}`;
    }
    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT je.id, je.entry_no, je.entry_date, je.reference, je.memo, je.status, je.posted_at, je.created_at,
              COALESCE(SUM(jel.debit), 0) AS total_debit
         FROM journal_entries je
         LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
        WHERE ${where}
        GROUP BY je.id
        ORDER BY je.entry_date DESC, je.entry_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const totalRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM journal_entries je WHERE ${where}`,
      params.slice(0, params.length - 2),
    );
    return {
      data: rows.map((r: Record<string, unknown>) => ({ ...r, total_debit: Number(r.total_debit) })),
      total: totalRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async post(id: string, userId: string): Promise<JournalEntry> {
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const entry = rows[0];
      if (!entry) throw new NotFoundException(`Journal entry ${id} not found`);
      if (entry.status === 'posted') throw new ConflictException('Already posted');
      if (entry.status === 'voided') throw new ConflictException('Cannot post a voided entry');

      // Recheck balance
      const totals = await tx.query(
        `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
           FROM journal_entry_lines WHERE entry_id = $1`,
        [id],
      );
      const d = Number(totals[0].d);
      const c = Number(totals[0].c);
      if (Math.abs(d - c) > 0.0001) {
        throw new BadRequestException(`Cannot post unbalanced entry. Debit ${d} Credit ${c}`);
      }
      if (d === 0) throw new BadRequestException('Cannot post entry with zero amount');

      // Recheck period
      const periods = await tx.query(
        `SELECT status FROM fiscal_periods WHERE id = $1 LIMIT 1`,
        [entry.fiscal_period_id],
      );
      if (periods[0]?.status === 'closed') {
        throw new BadRequestException('Fiscal period is closed');
      }

      await tx.query(
        `UPDATE journal_entries
           SET status = 'posted', posted_at = now(), posted_by = $2, updated_at = now()
         WHERE id = $1`,
        [id, userId],
      );

      // Update denormalised account balances
      await tx.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, jel.debit, jel.credit
           FROM journal_entry_lines jel
          WHERE jel.entry_id = $1
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
            SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [id, entry.fiscal_period_id],
      );

      await this.audit.record({
        userId,
        companyId: entry.company_id,
        action: 'post',
        entityType: 'journal_entry',
        entityId: id,
      });

      return this.findById(id);
    });
  }

  async void(id: string, userId: string, reason: string): Promise<JournalEntry> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Void reason is required (minimum 5 characters)');
    }
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM journal_entries WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const entry = rows[0];
      if (!entry) throw new NotFoundException(`Journal entry ${id} not found`);
      if (entry.status === 'voided') throw new ConflictException('Already voided');

      // Reverse the balance impact if it was posted
      if (entry.status === 'posted') {
        await tx.query(
          `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
           SELECT jel.account_id, $2, -jel.debit, -jel.credit
             FROM journal_entry_lines jel WHERE jel.entry_id = $1
           ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
              SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                  credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
          [id, entry.fiscal_period_id],
        );
      }

      await tx.query(
        `UPDATE journal_entries
           SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3
         WHERE id = $1`,
        [id, userId, reason],
      );

      await this.audit.record({
        userId,
        companyId: entry.company_id,
        action: 'void',
        entityType: 'journal_entry',
        entityId: id,
        afterState: { reason },
      });

      return this.findById(id);
    });
  }

  /**
   * Issue the next sequential document number from a series, advancing current_number atomically.
   * Returns a string like 'JV-2026-000152'.
   */
  private async nextDocumentNumber(
    tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> },
    companyId: string,
    docType: string,
  ): Promise<string> {
    const rows = (await tx.query(
      `UPDATE document_series
          SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number, end_number`,
      [companyId, docType],
    )) as Array<{ prefix: string; current_number: string; end_number: string | null }>;

    if (!rows[0]) {
      throw new BadRequestException(`No active document series for ${docType}`);
    }
    const { prefix, current_number, end_number } = rows[0];
    const n = Number(current_number);
    if (end_number !== null && n > Number(end_number)) {
      throw new BadRequestException(`Document series ${docType} has been exhausted`);
    }
    // Six-digit zero-padded suffix
    return `${prefix}${String(n).padStart(6, '0')}`;
  }

  private async findFiscalPeriod(companyId: string, isoDate: string) {
    const rows = await this.ds.query(
      `SELECT id, status FROM fiscal_periods
        WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date
        LIMIT 1`,
      [companyId, isoDate],
    );
    return rows[0];
  }
}
