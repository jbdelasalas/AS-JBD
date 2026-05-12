import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CustomerPayment, CreateCustomerPaymentDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class CollectionsService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(
    companyId: string,
    opts: {
      status?: string;
      customer_id?: string;
      from_date?: string;
      to_date?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `cp.company_id = $1`;

    if (opts.status) { params.push(opts.status); where += ` AND cp.status = $${params.length}`; }
    if (opts.customer_id) { params.push(opts.customer_id); where += ` AND cp.customer_id = $${params.length}`; }
    if (opts.from_date) { params.push(opts.from_date); where += ` AND cp.payment_date >= $${params.length}`; }
    if (opts.to_date) { params.push(opts.to_date); where += ` AND cp.payment_date <= $${params.length}`; }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT cp.id, cp.receipt_no, cp.payment_date, cp.payment_method,
              cp.amount, cp.unapplied_amount, cp.is_advance, cp.status,
              c.name AS customer_name, c.code AS customer_code
         FROM customer_payments cp
         JOIN customers c ON c.id = cp.customer_id
        WHERE ${where}
        ORDER BY cp.payment_date DESC, cp.receipt_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM customer_payments cp WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows.map(this.mapRow),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<CustomerPayment> {
    const headers = await this.ds.query(
      `SELECT cp.*, c.name AS customer_name, c.code AS customer_code
         FROM customer_payments cp
         JOIN customers c ON c.id = cp.customer_id
        WHERE cp.id = $1 LIMIT 1`,
      [id],
    );
    if (!headers[0]) throw new NotFoundException(`Payment ${id} not found`);

    const apps = await this.ds.query(
      `SELECT pa.*, si.invoice_no FROM payment_applications pa
         JOIN sales_invoices si ON si.id = pa.invoice_id
        WHERE pa.payment_id = $1`,
      [id],
    );

    return {
      ...this.mapRow(headers[0]),
      applications: apps.map((a: Record<string, unknown>) => ({
        ...a,
        amount_applied: Number(a.amount_applied),
      })),
    } as unknown as CustomerPayment;
  }

  async create(dto: CreateCustomerPaymentDto, userId: string): Promise<CustomerPayment> {
    const customers = await this.ds.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [dto.customer_id, dto.company_id],
    );
    if (!customers[0]) throw new NotFoundException('Customer not found or inactive');

    if (dto.amount <= 0) throw new BadRequestException('Payment amount must be positive');

    const appTotal = (dto.applications ?? []).reduce((s, a) => s + a.amount_applied, 0);
    if (appTotal > dto.amount + 0.0001) {
      throw new BadRequestException('Applied amounts exceed payment amount');
    }

    return this.ds.transaction(async (tx) => {
      const receiptNo = await this.nextDocNo(tx, dto.company_id, 'official_receipt');
      const unapplied = dto.amount - appTotal;

      const headerRows = await tx.query(
        `INSERT INTO customer_payments
           (company_id, branch_id, receipt_no, customer_id, payment_date,
            payment_method, reference, bank_ref, check_date, amount,
            unapplied_amount, is_advance, bank_account_id, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15)
         RETURNING *`,
        [
          dto.company_id, dto.branch_id ?? null, receiptNo, dto.customer_id,
          dto.payment_date, dto.payment_method,
          dto.reference ?? null, dto.bank_ref ?? null, dto.check_date ?? null,
          dto.amount.toFixed(2), unapplied.toFixed(2),
          dto.is_advance ?? (appTotal === 0),
          dto.bank_account_id ?? null, dto.notes ?? null, userId,
        ],
      );
      const header = headerRows[0];

      for (const app of dto.applications ?? []) {
        const invRows = await tx.query(
          `SELECT id, balance, status, customer_id FROM sales_invoices WHERE id = $1 FOR UPDATE`,
          [app.invoice_id],
        );
        if (!invRows[0]) throw new NotFoundException(`Invoice ${app.invoice_id} not found`);
        const inv = invRows[0] as Record<string, unknown>;

        if (inv.customer_id !== dto.customer_id) {
          throw new BadRequestException(`Invoice ${app.invoice_id} belongs to a different customer`);
        }
        if (!['open', 'partially_paid', 'overdue'].includes(inv.status as string)) {
          throw new BadRequestException(`Invoice ${app.invoice_id} is ${inv.status}`);
        }

        const invBalance = Number(inv.balance);
        if (app.amount_applied > invBalance + 0.0001) {
          throw new BadRequestException(
            `Cannot apply ${app.amount_applied} to invoice with balance ${invBalance.toFixed(2)}`,
          );
        }

        await tx.query(
          `INSERT INTO payment_applications (payment_id, invoice_id, amount_applied)
           VALUES ($1,$2,$3)`,
          [header.id, app.invoice_id, app.amount_applied],
        );
      }

      await this.audit.record({
        userId, companyId: dto.company_id,
        action: 'create', entityType: 'customer_payment', entityId: header.id,
        afterState: { receipt_no: receiptNo, amount: dto.amount },
      });

      return this.findById(header.id);
    });
  }

  async post(id: string, userId: string): Promise<CustomerPayment> {
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT cp.*, c.ar_account_id
           FROM customer_payments cp
           JOIN customers c ON c.id = cp.customer_id
          WHERE cp.id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Payment ${id} not found`);
      const pmt = rows[0] as Record<string, unknown>;

      if (pmt.status !== 'draft') throw new ConflictException(`Payment is already ${pmt.status}`);

      const period = await this.findFiscalPeriod(pmt.company_id as string, pmt.payment_date as string);
      if (!period) throw new BadRequestException(`No fiscal period for ${pmt.payment_date}`);
      if (period.status === 'closed') throw new BadRequestException('Fiscal period is closed');

      // Resolve AR control account
      let arAccountId = pmt.ar_account_id;
      if (!arAccountId) {
        const ctrlRows = await tx.query(
          `SELECT id FROM accounts
            WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true
            ORDER BY code ASC LIMIT 1`,
          [pmt.company_id],
        );
        arAccountId = ctrlRows[0]?.id;
        if (!arAccountId) throw new BadRequestException('No AR control account configured');
      }

      // Resolve cash/bank account
      let cashAccountId = pmt.bank_account_id;
      if (!cashAccountId) {
        const cashRows = await tx.query(
          `SELECT id FROM accounts
            WHERE company_id = $1 AND account_type = 'ASSET'
              AND (name ILIKE '%cash%' OR name ILIKE '%bank%')
              AND is_active = true
            ORDER BY code ASC LIMIT 1`,
          [pmt.company_id],
        );
        cashAccountId = cashRows[0]?.id;
        if (!cashAccountId) throw new BadRequestException('No cash/bank account configured');
      }

      const amount = Number(pmt.amount);

      // Build JE: DR Cash/Bank, CR AR
      const jeNo = await this.nextDocNo(tx, pmt.company_id as string, 'journal_voucher');
      const jeRows = await tx.query(
        `INSERT INTO journal_entries
           (company_id, branch_id, entry_no, entry_date, fiscal_period_id,
            reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','customer_payment',$8,'posted',$9)
         RETURNING *`,
        [
          pmt.company_id, pmt.branch_id ?? null, jeNo,
          pmt.payment_date, period.id, pmt.receipt_no,
          `OR ${pmt.receipt_no} — ${pmt.customer_name ?? ''}`,
          id, userId,
        ],
      );
      const je = jeRows[0];

      // DR Cash/Bank
      await tx.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,1,$2,$3,$4,0,'PHP',1,$4,0)`,
        [je.id, cashAccountId, `Receipt — ${pmt.receipt_no}`, amount],
      );

      // CR AR
      await tx.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,2,$2,$3,0,$4,'PHP',1,0,$4)`,
        [je.id, arAccountId, `AR payment — ${pmt.receipt_no}`, amount],
      );

      // Update account balances
      await tx.query(
        `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
         SELECT jel.account_id, $2, jel.debit, jel.credit
           FROM journal_entry_lines jel WHERE jel.entry_id = $1
         ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
           SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
               credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
        [je.id, period.id],
      );

      await tx.query(
        `UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`,
        [je.id, userId],
      );

      // Apply payment to invoices and update their balances
      const apps = await tx.query(
        `SELECT pa.invoice_id, pa.amount_applied FROM payment_applications WHERE payment_id = $1`,
        [id],
      );

      for (const app of apps as Array<{ invoice_id: string; amount_applied: string }>) {
        const applied = Number(app.amount_applied);
        const invRows = await tx.query(
          `SELECT balance, total FROM sales_invoices WHERE id = $1 FOR UPDATE`,
          [app.invoice_id],
        );
        if (!invRows[0]) continue;

        const newBalance = Number(invRows[0].balance) - applied;
        const newStatus = newBalance <= 0.001 ? 'paid' : 'partially_paid';

        await tx.query(
          `UPDATE sales_invoices
             SET balance = $2, amount_paid = amount_paid + $3, status = $4
           WHERE id = $1`,
          [app.invoice_id, Math.max(newBalance, 0).toFixed(2), applied.toFixed(2), newStatus],
        );
      }

      await tx.query(
        `UPDATE customer_payments
           SET status = 'posted', posted_at = now(), je_id = $2
         WHERE id = $1`,
        [id, je.id],
      );

      await this.audit.record({
        userId, companyId: pmt.company_id as string,
        action: 'post', entityType: 'customer_payment', entityId: id,
        afterState: { je_id: je.id },
      });

      return this.findById(id);
    });
  }

  async void(id: string, userId: string, reason: string): Promise<CustomerPayment> {
    if (!reason?.trim()) throw new BadRequestException('Void reason required');

    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM customer_payments WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Payment ${id} not found`);
      const pmt = rows[0] as Record<string, unknown>;

      if (['cancelled', 'draft'].includes(pmt.status as string)) {
        throw new BadRequestException(`Cannot void payment in status: ${pmt.status}`);
      }

      // Reverse invoice applications
      const apps = await tx.query(
        `SELECT pa.invoice_id, pa.amount_applied FROM payment_applications WHERE payment_id = $1`,
        [id],
      );

      for (const app of apps as Array<{ invoice_id: string; amount_applied: string }>) {
        const applied = Number(app.amount_applied);
        const invRows = await tx.query(
          `SELECT balance, total, amount_paid FROM sales_invoices WHERE id = $1 FOR UPDATE`,
          [app.invoice_id],
        );
        if (!invRows[0]) continue;

        const newBalance = Number(invRows[0].balance) + applied;
        const newAmtPaid = Math.max(Number(invRows[0].amount_paid) - applied, 0);
        const newStatus = newAmtPaid <= 0 ? 'open' : 'partially_paid';

        await tx.query(
          `UPDATE sales_invoices
             SET balance = $2, amount_paid = $3, status = $4
           WHERE id = $1`,
          [app.invoice_id, newBalance.toFixed(2), newAmtPaid.toFixed(2), newStatus],
        );
      }

      // Reverse GL if posted
      if (pmt.je_id) {
        const jeRows = await tx.query(`SELECT * FROM journal_entries WHERE id = $1`, [pmt.je_id]);
        if (jeRows[0]?.status === 'posted') {
          await tx.query(
            `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
             SELECT jel.account_id, $2, -jel.debit, -jel.credit
               FROM journal_entry_lines jel WHERE jel.entry_id = $1
             ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
               SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                   credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
            [pmt.je_id, jeRows[0].fiscal_period_id],
          );
          await tx.query(
            `UPDATE journal_entries SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
            [pmt.je_id, userId, reason],
          );
        }
      }

      await tx.query(
        `UPDATE customer_payments
           SET status = 'cancelled', voided_by = $2, voided_at = now(), void_reason = $3
         WHERE id = $1`,
        [id, userId, reason],
      );

      await this.audit.record({
        userId, companyId: pmt.company_id as string,
        action: 'void', entityType: 'customer_payment', entityId: id,
        afterState: { reason },
      });

      return this.findById(id);
    });
  }

  private async findFiscalPeriod(companyId: string, isoDate: string) {
    const rows = await this.ds.query(
      `SELECT id, status FROM fiscal_periods
        WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [companyId, isoDate],
    );
    return rows[0];
  }

  private async nextDocNo(
    tx: { query: (sql: string, p?: unknown[]) => Promise<unknown[]> },
    companyId: string,
    docType: string,
  ): Promise<string> {
    const rows = (await tx.query(
      `UPDATE document_series
          SET current_number = current_number + 1, updated_at = now()
        WHERE company_id = $1 AND doc_type = $2 AND is_active = true
        RETURNING prefix, current_number`,
      [companyId, docType],
    )) as Array<{ prefix: string; current_number: string }>;

    if (!rows[0]) throw new BadRequestException(`No active document series for ${docType}`);
    const n = Number(rows[0].current_number);
    return `${rows[0].prefix}${String(n).padStart(6, '0')}`;
  }

  private mapRow(r: Record<string, unknown>) {
    return {
      ...r,
      amount: Number(r.amount),
      unapplied_amount: Number(r.unapplied_amount ?? 0),
    };
  }
}
