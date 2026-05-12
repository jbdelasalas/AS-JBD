import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { SalesInvoice, CreateSalesInvoiceDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class SalesInvoicesService {
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
    let where = `si.company_id = $1`;

    if (opts.status) { params.push(opts.status); where += ` AND si.status = $${params.length}`; }
    if (opts.customer_id) { params.push(opts.customer_id); where += ` AND si.customer_id = $${params.length}`; }
    if (opts.from_date) { params.push(opts.from_date); where += ` AND si.invoice_date >= $${params.length}`; }
    if (opts.to_date) { params.push(opts.to_date); where += ` AND si.invoice_date <= $${params.length}`; }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT si.id, si.invoice_no, si.invoice_date, si.due_date,
              si.subtotal, si.vat_amount, si.total, si.amount_paid, si.balance, si.status,
              c.name AS customer_name, c.code AS customer_code
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
        WHERE ${where}
        ORDER BY si.invoice_date DESC, si.invoice_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM sales_invoices si WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows.map(this.mapRow),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<SalesInvoice> {
    const headers = await this.ds.query(
      `SELECT si.*, c.name AS customer_name, c.code AS customer_code,
              so.order_no, dr.dr_no
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
         LEFT JOIN sales_orders so ON so.id = si.so_id
         LEFT JOIN delivery_receipts dr ON dr.id = si.dr_id
        WHERE si.id = $1 LIMIT 1`,
      [id],
    );
    if (!headers[0]) throw new NotFoundException(`Invoice ${id} not found`);

    const lines = await this.ds.query(
      `SELECT sil.*, i.sku AS item_sku, i.name AS item_name
         FROM sales_invoice_lines sil
         LEFT JOIN items i ON i.id = sil.item_id
        WHERE sil.invoice_id = $1
        ORDER BY sil.line_no`,
      [id],
    );

    return {
      ...this.mapRow(headers[0]),
      lines: lines.map((l: Record<string, unknown>) => this.mapLine(l)),
    } as unknown as SalesInvoice;
  }

  async create(dto: CreateSalesInvoiceDto, userId: string): Promise<SalesInvoice> {
    if (!dto.lines?.length) throw new BadRequestException('Invoice must have at least one line');

    const customers = await this.ds.query(
      `SELECT id, payment_terms_days FROM customers
        WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [dto.customer_id, dto.company_id],
    );
    if (!customers[0]) throw new NotFoundException('Customer not found or inactive');

    return this.ds.transaction(async (tx) => {
      const invoiceNo = await this.nextDocNo(tx, dto.company_id, 'sales_invoice');
      const terms = dto.payment_terms_days ?? customers[0].payment_terms_days ?? 30;

      const lines = dto.lines.map((l, idx) => {
        const vatRate = l.vat_rate ?? 12;
        const disc = l.discount_pct ?? 0;
        const subtotal = parseFloat((l.quantity * l.unit_price * (1 - disc / 100)).toFixed(2));
        const vat = parseFloat((subtotal * (vatRate / 100)).toFixed(2));
        return { ...l, line_no: idx + 1, vatRate, disc, subtotal, vat, total: subtotal + vat };
      });

      const totSubtotal = lines.reduce((s, l) => s + l.subtotal, 0);
      const totVat = lines.reduce((s, l) => s + l.vat, 0);
      const totTotal = lines.reduce((s, l) => s + l.total, 0);
      const dueDate = new Date(dto.invoice_date);
      dueDate.setDate(dueDate.getDate() + terms);

      const headerRows = await tx.query(
        `INSERT INTO sales_invoices
           (company_id, branch_id, invoice_no, customer_id, so_id, dr_id,
            invoice_date, due_date, payment_terms_days, reference, notes,
            subtotal, vat_amount, total, amount_paid, balance, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0,$14,'draft',$15)
         RETURNING *`,
        [
          dto.company_id, dto.branch_id ?? null, invoiceNo, dto.customer_id,
          dto.so_id ?? null, dto.dr_id ?? null,
          dto.invoice_date, dueDate.toISOString().split('T')[0], terms,
          dto.reference ?? null, dto.notes ?? null,
          totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), userId,
        ],
      );
      const header = headerRows[0];

      for (const l of lines) {
        await tx.query(
          `INSERT INTO sales_invoice_lines
             (invoice_id, line_no, item_id, description, quantity, unit_price,
              discount_pct, vat_rate, line_subtotal, line_vat, line_total, revenue_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            header.id, l.line_no, l.item_id ?? null, l.description,
            l.quantity, l.unit_price, l.disc, l.vatRate,
            l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
            l.revenue_account_id ?? null,
          ],
        );
      }

      await this.audit.record({
        userId, companyId: dto.company_id,
        action: 'create', entityType: 'sales_invoice', entityId: header.id,
        afterState: { invoice_no: invoiceNo },
      });

      return this.findById(header.id);
    });
  }

  async post(id: string, userId: string): Promise<SalesInvoice> {
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT si.*, c.ar_account_id, co.id AS co_id
           FROM sales_invoices si
           JOIN customers c ON c.id = si.customer_id
           JOIN companies co ON co.id = si.company_id
          WHERE si.id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Invoice ${id} not found`);
      const inv = rows[0] as Record<string, unknown>;

      if (inv.status === 'open') throw new ConflictException('Invoice is already posted');
      if (inv.status === 'cancelled') throw new BadRequestException('Invoice is cancelled');
      if (inv.status !== 'draft') throw new BadRequestException(`Invoice is ${inv.status}`);

      // Validate fiscal period
      const period = await this.findFiscalPeriod(inv.company_id as string, inv.invoice_date as string);
      if (!period) throw new BadRequestException(`No fiscal period for ${inv.invoice_date}`);
      if (period.status === 'closed') throw new BadRequestException('Fiscal period is closed');

      // Resolve AR control account
      let arAccountId = inv.ar_account_id;
      if (!arAccountId) {
        const ctrlRows = await tx.query(
          `SELECT id FROM accounts
            WHERE company_id = $1 AND is_control = true
              AND account_type = 'ASSET' AND is_active = true
            ORDER BY code ASC LIMIT 1`,
          [inv.company_id],
        );
        arAccountId = ctrlRows[0]?.id;
        if (!arAccountId) throw new BadRequestException('No AR control account configured');
      }

      // Resolve default output VAT account and revenue accounts per line
      const vatAccountRows = await tx.query(
        `SELECT id FROM accounts
          WHERE company_id = $1 AND account_type = 'LIABILITY'
            AND (code LIKE '%VAT%' OR name ILIKE '%output%vat%')
            AND is_active = true
          ORDER BY code ASC LIMIT 1`,
        [inv.company_id],
      );
      const vatAccountId = vatAccountRows[0]?.id;

      const lines = await tx.query(
        `SELECT sil.*, i.revenue_account_id AS item_revenue_acct
           FROM sales_invoice_lines sil
           LEFT JOIN items i ON i.id = sil.item_id
          WHERE sil.invoice_id = $1`,
        [id],
      );

      // Build journal entry
      const total = Number(inv.total);
      const vatAmount = Number(inv.vat_amount);
      const subtotal = Number(inv.subtotal);

      const jeRows = await tx.query(
        `INSERT INTO journal_entries
           (company_id, branch_id, entry_no, entry_date, fiscal_period_id,
            reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','sales_invoice',$8,'posted',$9)
         RETURNING *`,
        [
          inv.company_id, inv.branch_id ?? null,
          await this.nextDocNo(tx, inv.company_id as string, 'journal_voucher'),
          inv.invoice_date, period.id,
          inv.invoice_no,
          `SI ${inv.invoice_no} — ${inv.customer_name ?? ''}`,
          id, userId,
        ],
      );
      const je = jeRows[0];

      let lineNo = 1;

      // DR Accounts Receivable
      await tx.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
        [je.id, lineNo++, arAccountId, `AR — ${inv.invoice_no}`, total],
      );

      // CR Revenue per line
      for (const l of lines as Array<Record<string, unknown>>) {
        const revenueAcct = l.revenue_account_id ?? l.item_revenue_acct;
        if (!revenueAcct) continue;
        const lineSubtotal = Number(l.line_subtotal);
        await tx.query(
          `INSERT INTO journal_entry_lines
             (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
          [je.id, lineNo++, revenueAcct, l.description, lineSubtotal],
        );
      }

      // CR Output VAT (if any VAT)
      if (vatAmount > 0 && vatAccountId) {
        await tx.query(
          `INSERT INTO journal_entry_lines
             (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
          [je.id, lineNo++, vatAccountId, `Output VAT — ${inv.invoice_no}`, vatAmount],
        );
      }

      // If lines had no revenue accounts, post to a catch-all credit for the subtotal
      const lineRevTotal = (lines as Array<Record<string, unknown>>)
        .filter((l) => l.revenue_account_id ?? l.item_revenue_acct)
        .reduce((s, l) => s + Number(l.line_subtotal), 0);

      if (Math.abs(lineRevTotal - subtotal) > 0.01) {
        const defaultRevRows = await tx.query(
          `SELECT id FROM accounts
            WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true
            ORDER BY code ASC LIMIT 1`,
          [inv.company_id],
        );
        if (defaultRevRows[0]) {
          const diff = subtotal - lineRevTotal;
          await tx.query(
            `INSERT INTO journal_entry_lines
               (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
             VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
            [je.id, lineNo++, defaultRevRows[0].id, `Revenue — ${inv.invoice_no}`, diff],
          );
        }
      }

      // Update account_balances for posted JE
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

      await tx.query(
        `UPDATE sales_invoices
           SET status = 'open', je_id = $2, posted_at = now()
         WHERE id = $1`,
        [id, je.id],
      );

      await this.audit.record({
        userId, companyId: inv.company_id as string,
        action: 'post', entityType: 'sales_invoice', entityId: id,
        afterState: { je_id: je.id },
      });

      return this.findById(id);
    });
  }

  async void(id: string, userId: string, reason: string): Promise<SalesInvoice> {
    if (!reason?.trim()) throw new BadRequestException('Void reason required');

    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Invoice ${id} not found`);
      const inv = rows[0] as Record<string, unknown>;

      if (['cancelled', 'paid'].includes(inv.status as string)) {
        throw new BadRequestException(`Cannot void invoice in status: ${inv.status}`);
      }
      if (Number(inv.amount_paid) > 0) {
        throw new BadRequestException('Cannot void partially or fully paid invoice');
      }

      if (inv.je_id) {
        // Reverse GL balances
        const jeRows = await tx.query(
          `SELECT * FROM journal_entries WHERE id = $1`, [inv.je_id],
        );
        if (jeRows[0]?.status === 'posted') {
          await tx.query(
            `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
             SELECT jel.account_id, $2, -jel.debit, -jel.credit
               FROM journal_entry_lines jel WHERE jel.entry_id = $1
             ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
               SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                   credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
            [inv.je_id, jeRows[0].fiscal_period_id],
          );
          await tx.query(
            `UPDATE journal_entries SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
            [inv.je_id, userId, reason],
          );
        }
      }

      await tx.query(
        `UPDATE sales_invoices
           SET status = 'cancelled', voided_at = now(), voided_by = $2, void_reason = $3
         WHERE id = $1`,
        [id, userId, reason],
      );

      await this.audit.record({
        userId, companyId: inv.company_id as string,
        action: 'void', entityType: 'sales_invoice', entityId: id,
        afterState: { reason },
      });

      return this.findById(id);
    });
  }

  async updateOverdueStatuses(companyId: string): Promise<number> {
    const result = await this.ds.query(
      `UPDATE sales_invoices
          SET status = 'overdue'
        WHERE company_id = $1
          AND status = 'open'
          AND due_date < CURRENT_DATE
          AND balance > 0`,
      [companyId],
    );
    return result[1] ?? 0;
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
        RETURNING prefix, current_number, end_number`,
      [companyId, docType],
    )) as Array<{ prefix: string; current_number: string; end_number: string | null }>;

    if (!rows[0]) throw new BadRequestException(`No active document series for ${docType}`);
    const n = Number(rows[0].current_number);
    return `${rows[0].prefix}${String(n).padStart(6, '0')}`;
  }

  private mapRow(r: Record<string, unknown>) {
    return {
      ...r,
      subtotal: Number(r.subtotal),
      vat_amount: Number(r.vat_amount),
      total: Number(r.total),
      amount_paid: Number(r.amount_paid),
      balance: Number(r.balance),
      discount_amount: Number(r.discount_amount ?? 0),
    };
  }

  private mapLine(l: Record<string, unknown>) {
    return {
      ...l,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      discount_pct: Number(l.discount_pct ?? 0),
      vat_rate: Number(l.vat_rate),
      line_subtotal: Number(l.line_subtotal),
      line_vat: Number(l.line_vat),
      line_total: Number(l.line_total),
    };
  }
}
