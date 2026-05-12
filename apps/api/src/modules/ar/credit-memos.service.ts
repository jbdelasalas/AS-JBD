import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ARCreditMemo, CreateARCreditMemoDto, ApplyCreditMemoDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class CreditMemosService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(
    companyId: string,
    opts: { status?: string; customer_id?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `cm.company_id = $1`;

    if (opts.status) { params.push(opts.status); where += ` AND cm.status = $${params.length}`; }
    if (opts.customer_id) { params.push(opts.customer_id); where += ` AND cm.customer_id = $${params.length}`; }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT cm.id, cm.cm_no, cm.cm_date, cm.total, cm.amount_applied,
              cm.unapplied_amount, cm.status, c.name AS customer_name,
              si.invoice_no AS original_invoice_no
         FROM ar_credit_memos cm
         JOIN customers c ON c.id = cm.customer_id
         LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id
        WHERE ${where}
        ORDER BY cm.cm_date DESC, cm.cm_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM ar_credit_memos cm WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows.map(this.mapRow),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<ARCreditMemo> {
    const headers = await this.ds.query(
      `SELECT cm.*, c.name AS customer_name, si.invoice_no
         FROM ar_credit_memos cm
         JOIN customers c ON c.id = cm.customer_id
         LEFT JOIN sales_invoices si ON si.id = cm.original_invoice_id
        WHERE cm.id = $1 LIMIT 1`,
      [id],
    );
    if (!headers[0]) throw new NotFoundException(`Credit memo ${id} not found`);

    const lines = await this.ds.query(
      `SELECT cml.*, i.sku AS item_sku, i.name AS item_name
         FROM ar_credit_memo_lines cml
         LEFT JOIN items i ON i.id = cml.item_id
        WHERE cml.cm_id = $1
        ORDER BY cml.line_no`,
      [id],
    );

    return {
      ...this.mapRow(headers[0]),
      lines: lines.map((l: Record<string, unknown>) => this.mapLine(l)),
    } as unknown as ARCreditMemo;
  }

  async create(dto: CreateARCreditMemoDto, userId: string): Promise<ARCreditMemo> {
    if (!dto.lines?.length) throw new BadRequestException('Credit memo must have at least one line');

    const customers = await this.ds.query(
      `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [dto.customer_id, dto.company_id],
    );
    if (!customers[0]) throw new NotFoundException('Customer not found or inactive');

    if (dto.original_invoice_id) {
      const invRows = await this.ds.query(
        `SELECT id, status, customer_id FROM sales_invoices WHERE id = $1`,
        [dto.original_invoice_id],
      );
      if (!invRows[0]) throw new NotFoundException('Original invoice not found');
      if (invRows[0].customer_id !== dto.customer_id) {
        throw new BadRequestException('Invoice belongs to a different customer');
      }
      if (invRows[0].status === 'cancelled') {
        throw new BadRequestException('Cannot create credit memo against cancelled invoice');
      }
    }

    return this.ds.transaction(async (tx) => {
      const cmNo = await this.nextDocNo(tx, dto.company_id, 'credit_memo');

      const lines = dto.lines.map((l, idx) => {
        const vatRate = l.vat_rate ?? 12;
        const subtotal = parseFloat((l.quantity * l.unit_price).toFixed(2));
        const vat = parseFloat((subtotal * (vatRate / 100)).toFixed(2));
        return { ...l, line_no: idx + 1, vatRate, subtotal, vat, total: subtotal + vat };
      });

      const totSubtotal = lines.reduce((s, l) => s + l.subtotal, 0);
      const totVat = lines.reduce((s, l) => s + l.vat, 0);
      const totTotal = lines.reduce((s, l) => s + l.total, 0);

      const headerRows = await tx.query(
        `INSERT INTO ar_credit_memos
           (company_id, branch_id, cm_no, customer_id, original_invoice_id,
            cm_date, reason, notes, subtotal, vat_amount, total,
            amount_applied, unapplied_amount, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$11,'draft',$12)
         RETURNING *`,
        [
          dto.company_id, dto.branch_id ?? null, cmNo, dto.customer_id,
          dto.original_invoice_id ?? null, dto.cm_date,
          dto.reason ?? null, dto.notes ?? null,
          totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), userId,
        ],
      );
      const header = headerRows[0];

      for (const l of lines) {
        await tx.query(
          `INSERT INTO ar_credit_memo_lines
             (cm_id, line_no, item_id, description, quantity, unit_price,
              vat_rate, line_subtotal, line_vat, line_total, revenue_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            header.id, l.line_no, l.item_id ?? null, l.description,
            l.quantity, l.unit_price, l.vatRate,
            l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
            l.revenue_account_id ?? null,
          ],
        );
      }

      await this.audit.record({
        userId, companyId: dto.company_id,
        action: 'create', entityType: 'ar_credit_memo', entityId: header.id,
        afterState: { cm_no: cmNo },
      });

      return this.findById(header.id);
    });
  }

  async submitForApproval(id: string, userId: string): Promise<ARCreditMemo> {
    const cm = await this.findById(id);
    if (cm.status !== 'draft') throw new BadRequestException(`Cannot submit: CM is ${cm.status}`);

    await this.ds.query(
      `UPDATE ar_credit_memos SET status = 'pending_approval' WHERE id = $1`,
      [id],
    );

    await this.audit.record({
      userId, companyId: cm.company_id,
      action: 'submit_approval', entityType: 'ar_credit_memo', entityId: id,
    });

    return this.findById(id);
  }

  async approve(id: string, userId: string): Promise<ARCreditMemo> {
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT cm.*, c.ar_account_id FROM ar_credit_memos cm
           JOIN customers c ON c.id = cm.customer_id
          WHERE cm.id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Credit memo ${id} not found`);
      const cm = rows[0] as Record<string, unknown>;

      if (cm.status !== 'pending_approval') {
        throw new BadRequestException(`Cannot approve: CM is ${cm.status}`);
      }

      // Validate fiscal period
      const period = await this.findFiscalPeriod(cm.company_id as string, cm.cm_date as string);
      if (!period) throw new BadRequestException(`No fiscal period for ${cm.cm_date}`);
      if (period.status === 'closed') throw new BadRequestException('Fiscal period is closed');

      // Resolve AR account
      let arAccountId = cm.ar_account_id;
      if (!arAccountId) {
        const ctrlRows = await tx.query(
          `SELECT id FROM accounts
            WHERE company_id = $1 AND is_control = true AND account_type = 'ASSET' AND is_active = true
            ORDER BY code ASC LIMIT 1`,
          [cm.company_id],
        );
        arAccountId = ctrlRows[0]?.id;
        if (!arAccountId) throw new BadRequestException('No AR control account configured');
      }

      const total = Number(cm.total);
      const vatAmount = Number(cm.vat_amount);
      const subtotal = Number(cm.subtotal);

      const vatAccountRows = await tx.query(
        `SELECT id FROM accounts
          WHERE company_id = $1 AND account_type = 'LIABILITY'
            AND (code LIKE '%VAT%' OR name ILIKE '%output%vat%')
            AND is_active = true
          ORDER BY code ASC LIMIT 1`,
        [cm.company_id],
      );
      const vatAccountId = vatAccountRows[0]?.id;

      const defaultRevRows = await tx.query(
        `SELECT id FROM accounts
          WHERE company_id = $1 AND account_type = 'REVENUE' AND is_active = true
          ORDER BY code ASC LIMIT 1`,
        [cm.company_id],
      );

      // Build reversal JE: CR AR, DR Revenue, DR VAT
      const jeNo = await this.nextDocNo(tx, cm.company_id as string, 'journal_voucher');
      const jeRows = await tx.query(
        `INSERT INTO journal_entries
           (company_id, branch_id, entry_no, entry_date, fiscal_period_id,
            reference, memo, source_module, source_doc_type, source_doc_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ar','credit_memo',$8,'posted',$9)
         RETURNING *`,
        [
          cm.company_id, cm.branch_id ?? null, jeNo,
          cm.cm_date, period.id, cm.cm_no,
          `CM ${cm.cm_no} — ${cm.customer_name ?? ''}`,
          id, userId,
        ],
      );
      const je = jeRows[0];

      let lineNo = 1;

      // CR Accounts Receivable (reduces AR balance)
      await tx.query(
        `INSERT INTO journal_entry_lines
           (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
         VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
        [je.id, lineNo++, arAccountId, `AR reduction — ${cm.cm_no}`, total],
      );

      // DR Revenue (reversal)
      if (defaultRevRows[0]) {
        await tx.query(
          `INSERT INTO journal_entry_lines
             (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [je.id, lineNo++, defaultRevRows[0].id, `Revenue reversal — ${cm.cm_no}`, subtotal],
        );
      }

      // DR Output VAT (reversal)
      if (vatAmount > 0 && vatAccountId) {
        await tx.query(
          `INSERT INTO journal_entry_lines
             (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
           VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
          [je.id, lineNo++, vatAccountId, `VAT reversal — ${cm.cm_no}`, vatAmount],
        );
      }

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

      await tx.query(
        `UPDATE ar_credit_memos
           SET status = 'approved', approved_by = $2, approved_at = now(), je_id = $3
         WHERE id = $1`,
        [id, userId, je.id],
      );

      await this.audit.record({
        userId, companyId: cm.company_id as string,
        action: 'approve', entityType: 'ar_credit_memo', entityId: id,
      });

      return this.findById(id);
    });
  }

  async apply(id: string, dto: ApplyCreditMemoDto, userId: string): Promise<ARCreditMemo> {
    if (!dto.applications?.length) throw new BadRequestException('No applications provided');

    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT * FROM ar_credit_memos WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Credit memo ${id} not found`);
      const cm = rows[0] as Record<string, unknown>;

      if (cm.status !== 'approved') {
        throw new BadRequestException(`Can only apply approved credit memos (current: ${cm.status})`);
      }

      const totalApplying = dto.applications.reduce((s, a) => s + a.amount_applied, 0);
      const available = Number(cm.unapplied_amount);

      if (totalApplying > available + 0.0001) {
        throw new BadRequestException(
          `Total applying (${totalApplying.toFixed(2)}) exceeds available (${available.toFixed(2)})`,
        );
      }

      for (const app of dto.applications) {
        const invRows = await tx.query(
          `SELECT id, balance, status, customer_id FROM sales_invoices WHERE id = $1 FOR UPDATE`,
          [app.invoice_id],
        );
        if (!invRows[0]) throw new NotFoundException(`Invoice ${app.invoice_id} not found`);
        const inv = invRows[0] as Record<string, unknown>;

        if (inv.customer_id !== cm.customer_id) {
          throw new BadRequestException(`Invoice ${app.invoice_id} belongs to a different customer`);
        }
        if (!['open', 'partially_paid', 'overdue'].includes(inv.status as string)) {
          throw new BadRequestException(`Invoice ${app.invoice_id} is ${inv.status}`);
        }

        const invBalance = Number(inv.balance);
        if (app.amount_applied > invBalance + 0.0001) {
          throw new BadRequestException(
            `Cannot apply ${app.amount_applied} to invoice with balance ${invBalance}`,
          );
        }

        await tx.query(
          `INSERT INTO ar_credit_memo_applications (cm_id, invoice_id, amount_applied, applied_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (cm_id, invoice_id) DO UPDATE SET amount_applied = $3`,
          [id, app.invoice_id, app.amount_applied, userId],
        );

        const newBalance = invBalance - app.amount_applied;
        const newStatus =
          newBalance <= 0.001 ? 'paid'
          : Number(inv.balance) < Number(inv.total ?? 0) ? 'partially_paid'
          : 'partially_paid';

        await tx.query(
          `UPDATE sales_invoices
             SET balance = $2, amount_paid = amount_paid + $3, status = $4
           WHERE id = $1`,
          [app.invoice_id, newBalance.toFixed(2), app.amount_applied.toFixed(2), newStatus],
        );
      }

      const newApplied = Number(cm.amount_applied) + totalApplying;
      const newUnapplied = Number(cm.total) - newApplied;
      const newStatus = newUnapplied <= 0.001 ? 'applied' : 'approved';

      await tx.query(
        `UPDATE ar_credit_memos
           SET amount_applied = $2, unapplied_amount = $3, status = $4
         WHERE id = $1`,
        [id, newApplied.toFixed(2), Math.max(newUnapplied, 0).toFixed(2), newStatus],
      );

      await this.audit.record({
        userId, companyId: cm.company_id as string,
        action: 'apply', entityType: 'ar_credit_memo', entityId: id,
        afterState: { applications: dto.applications },
      });

      return this.findById(id);
    });
  }

  async cancel(id: string, userId: string, reason: string): Promise<ARCreditMemo> {
    if (!reason?.trim()) throw new BadRequestException('Cancellation reason required');

    const cm = await this.findById(id);
    if (['applied', 'cancelled'].includes(cm.status)) {
      throw new BadRequestException(`Cannot cancel credit memo in status: ${cm.status}`);
    }
    if (cm.amount_applied > 0) {
      throw new BadRequestException('Cannot cancel credit memo with applied amounts');
    }

    await this.ds.query(
      `UPDATE ar_credit_memos
         SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
       WHERE id = $1`,
      [id, userId, reason],
    );

    await this.audit.record({
      userId, companyId: cm.company_id,
      action: 'cancel', entityType: 'ar_credit_memo', entityId: id,
      afterState: { reason },
    });

    return this.findById(id);
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
      subtotal: Number(r.subtotal),
      vat_amount: Number(r.vat_amount),
      total: Number(r.total),
      amount_applied: Number(r.amount_applied),
      unapplied_amount: Number(r.unapplied_amount),
    };
  }

  private mapLine(l: Record<string, unknown>) {
    return {
      ...l,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      vat_rate: Number(l.vat_rate),
      line_subtotal: Number(l.line_subtotal),
      line_vat: Number(l.line_vat),
      line_total: Number(l.line_total),
    };
  }
}
