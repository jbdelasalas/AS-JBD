import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { SalesOrder, CreateSalesOrderDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

const VALID_STATUSES = [
  'draft', 'pending_approval', 'approved',
  'partially_delivered', 'fully_delivered', 'closed', 'cancelled',
] as const;

@Injectable()
export class SalesOrdersService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(
    companyId: string,
    opts: { status?: string; customer_id?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `so.company_id = $1`;

    if (opts.status) {
      params.push(opts.status);
      where += ` AND so.status = $${params.length}`;
    }
    if (opts.customer_id) {
      params.push(opts.customer_id);
      where += ` AND so.customer_id = $${params.length}`;
    }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT so.id, so.order_no, so.order_date, so.delivery_date,
              so.subtotal, so.vat_amount, so.total, so.status,
              so.credit_checked, so.approved_at, so.created_at,
              c.name AS customer_name, c.code AS customer_code
         FROM sales_orders so
         JOIN customers c ON c.id = so.customer_id
        WHERE ${where}
        ORDER BY so.order_date DESC, so.order_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM sales_orders so WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows.map(this.mapRow),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<SalesOrder> {
    const headers = await this.ds.query(
      `SELECT so.*, c.name AS customer_name, c.code AS customer_code,
              c.credit_limit, c.payment_terms_days AS customer_terms
         FROM sales_orders so
         JOIN customers c ON c.id = so.customer_id
        WHERE so.id = $1 LIMIT 1`,
      [id],
    );
    if (!headers[0]) throw new NotFoundException(`Sales order ${id} not found`);
    const header = headers[0];

    const lines = await this.ds.query(
      `SELECT sol.*, i.sku AS item_sku, i.name AS item_name
         FROM sales_order_lines sol
         JOIN items i ON i.id = sol.item_id
        WHERE sol.order_id = $1
        ORDER BY sol.line_no`,
      [id],
    );

    return {
      ...this.mapRow(header),
      lines: lines.map((l: Record<string, unknown>) => this.mapLine(l)),
    } as unknown as SalesOrder;
  }

  async create(dto: CreateSalesOrderDto, userId: string): Promise<SalesOrder> {
    if (!dto.lines?.length) {
      throw new BadRequestException('Sales order must have at least one line');
    }

    // Validate customer
    const customers = await this.ds.query(
      `SELECT id, credit_limit, payment_terms_days FROM customers
        WHERE id = $1 AND company_id = $2 AND is_active = true`,
      [dto.customer_id, dto.company_id],
    );
    if (!customers[0]) throw new NotFoundException('Customer not found or inactive');

    // Validate items
    const itemIds = dto.lines.map((l) => l.item_id);
    const items = await this.ds.query(
      `SELECT id, name, selling_price, is_active FROM items
        WHERE id = ANY($1) AND company_id = $2`,
      [itemIds, dto.company_id],
    );
    if (items.length !== itemIds.length) {
      throw new BadRequestException('One or more items not found in this company');
    }
    const inactive = items.filter((i: { is_active: boolean }) => !i.is_active);
    if (inactive.length) {
      throw new BadRequestException(
        `Inactive items: ${inactive.map((i: { name: string }) => i.name).join(', ')}`,
      );
    }

    return this.ds.transaction(async (tx) => {
      const orderNo = await this.nextDocNo(tx, dto.company_id, 'sales_order');
      const terms = dto.payment_terms_days ?? customers[0].payment_terms_days ?? 30;

      // Compute totals
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

      const headerRows = await tx.query(
        `INSERT INTO sales_orders
           (company_id, branch_id, order_no, customer_id, order_date, delivery_date,
            warehouse_id, payment_terms_days, discount_pct, reference, notes,
            subtotal, vat_amount, total, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15)
         RETURNING *`,
        [
          dto.company_id, dto.branch_id ?? null, orderNo, dto.customer_id,
          dto.order_date, dto.delivery_date ?? null, dto.warehouse_id ?? null,
          terms, dto.discount_pct ?? 0, dto.reference ?? null, dto.notes ?? null,
          totSubtotal.toFixed(2), totVat.toFixed(2), totTotal.toFixed(2), userId,
        ],
      );
      const header = headerRows[0];

      for (const l of lines) {
        const itemRow = items.find((i: { id: string }) => i.id === l.item_id);
        await tx.query(
          `INSERT INTO sales_order_lines
             (order_id, line_no, item_id, description, quantity, qty_delivered, qty_reserved,
              unit_price, discount_pct, vat_rate, line_subtotal, line_vat, line_total)
           VALUES ($1,$2,$3,$4,$5,0,0,$6,$7,$8,$9,$10,$11)`,
          [
            header.id, l.line_no, l.item_id,
            l.description ?? itemRow?.name ?? '',
            l.quantity, l.unit_price, l.disc, l.vatRate,
            l.subtotal.toFixed(2), l.vat.toFixed(2), l.total.toFixed(2),
          ],
        );
      }

      await this.audit.record({
        userId, companyId: dto.company_id,
        action: 'create', entityType: 'sales_order', entityId: header.id,
        afterState: { order_no: orderNo, customer_id: dto.customer_id },
      });

      return this.findById(header.id);
    });
  }

  async submitForApproval(id: string, userId: string): Promise<SalesOrder> {
    return this.ds.transaction(async (tx) => {
      const so = await this.lockOrder(tx, id);
      if (so.status !== 'draft') {
        throw new BadRequestException(`Cannot submit: order is ${so.status}`);
      }

      // Credit check
      const creditRows = await tx.query(
        `SELECT c.credit_limit,
                COALESCE(SUM(si.balance), 0) AS open_ar
           FROM customers c
           LEFT JOIN sales_invoices si ON si.customer_id = c.id
             AND si.status IN ('open','partially_paid','overdue')
          WHERE c.id = $1 GROUP BY c.id`,
        [so.customer_id],
      );
      const creditLimit = Number(creditRows[0]?.credit_limit ?? 0);
      const openAr = Number(creditRows[0]?.open_ar ?? 0);
      const creditOk = creditLimit === 0 || (openAr + Number(so.total)) <= creditLimit;

      await tx.query(
        `UPDATE sales_orders
           SET status = 'pending_approval', credit_checked = $2
         WHERE id = $1`,
        [id, creditOk],
      );

      await this.audit.record({
        userId, companyId: so.company_id as string,
        action: 'submit_approval', entityType: 'sales_order', entityId: id,
        afterState: { credit_checked: creditOk },
      });

      return this.findById(id);
    });
  }

  async approve(id: string, userId: string, notes?: string): Promise<SalesOrder> {
    return this.ds.transaction(async (tx) => {
      const so = await this.lockOrder(tx, id);
      if (so.status !== 'pending_approval') {
        throw new BadRequestException(`Cannot approve: order is ${so.status as string}`);
      }

      await tx.query(
        `UPDATE sales_orders
           SET status = 'approved', approved_by = $2, approved_at = now(), approval_notes = $3
         WHERE id = $1`,
        [id, userId, notes ?? null],
      );

      // Reserve inventory
      const lines = await tx.query(
        `SELECT sol.id, sol.item_id, sol.quantity, sol.qty_delivered,
                so.warehouse_id
           FROM sales_order_lines sol
           JOIN sales_orders so ON so.id = sol.order_id
          WHERE sol.order_id = $1`,
        [id],
      ) as Array<Record<string, unknown>>;

      if (so.warehouse_id) {
        for (const line of lines) {
          const qty = Number(line.quantity) - Number(line.qty_delivered);
          if (qty <= 0) continue;

          await tx.query(
            `INSERT INTO inventory_reservations (so_id, so_line_id, item_id, warehouse_id, qty_reserved)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (so_line_id) DO UPDATE SET qty_reserved = $5, status = 'active'`,
            [id, line.id, line.item_id, so.warehouse_id, qty],
          );

          await tx.query(
            `UPDATE sales_order_lines SET qty_reserved = $2 WHERE id = $1`,
            [line.id, qty],
          );
        }
      }

      await this.audit.record({
        userId, companyId: so.company_id as string,
        action: 'approve', entityType: 'sales_order', entityId: id,
      });

      return this.findById(id);
    });
  }

  async cancel(id: string, userId: string, reason: string): Promise<SalesOrder> {
    if (!reason?.trim()) throw new BadRequestException('Cancellation reason required');

    return this.ds.transaction(async (tx) => {
      const so = await this.lockOrder(tx, id);
      if (['fully_delivered', 'closed', 'cancelled'].includes(so.status as string)) {
        throw new BadRequestException(`Cannot cancel: order is ${so.status as string}`);
      }

      await tx.query(
        `UPDATE inventory_reservations SET status = 'released', released_at = now()
         WHERE so_id = $1 AND status = 'active'`,
        [id],
      );

      await tx.query(
        `UPDATE sales_orders
           SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
         WHERE id = $1`,
        [id, userId, reason],
      );

      await this.audit.record({
        userId, companyId: so.company_id as string,
        action: 'cancel', entityType: 'sales_order', entityId: id,
        afterState: { reason },
      });

      return this.findById(id);
    });
  }

  async close(id: string, userId: string): Promise<SalesOrder> {
    return this.ds.transaction(async (tx) => {
      const so = await this.lockOrder(tx, id);
      if (!['approved', 'partially_delivered', 'fully_delivered'].includes(so.status as string)) {
        throw new BadRequestException(`Cannot close: order is ${so.status as string}`);
      }

      await tx.query(`UPDATE sales_orders SET status = 'closed' WHERE id = $1`, [id]);

      await tx.query(
        `UPDATE inventory_reservations SET status = 'released', released_at = now()
         WHERE so_id = $1 AND status = 'active'`,
        [id],
      );

      await this.audit.record({
        userId, companyId: so.company_id as string,
        action: 'close', entityType: 'sales_order', entityId: id,
      });

      return this.findById(id);
    });
  }

  private async lockOrder(
    tx: { query: (sql: string, p?: unknown[]) => Promise<unknown[]> },
    id: string,
  ): Promise<Record<string, unknown>> {
    const rows = (await tx.query(
      `SELECT so.*, c.credit_limit
         FROM sales_orders so
         JOIN customers c ON c.id = so.customer_id
        WHERE so.id = $1 FOR UPDATE`,
      [id],
    )) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundException(`Sales order ${id} not found`);
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
    const { prefix, current_number, end_number } = rows[0];
    const n = Number(current_number);
    if (end_number !== null && n > Number(end_number)) {
      throw new BadRequestException(`Document series ${docType} exhausted`);
    }
    return `${prefix}${String(n).padStart(6, '0')}`;
  }

  private mapRow(r: Record<string, unknown>) {
    return {
      ...r,
      subtotal: Number(r.subtotal),
      vat_amount: Number(r.vat_amount),
      total: Number(r.total),
      discount_pct: Number(r.discount_pct ?? 0),
    };
  }

  private mapLine(l: Record<string, unknown>) {
    return {
      ...l,
      quantity: Number(l.quantity),
      qty_delivered: Number(l.qty_delivered),
      qty_reserved: Number(l.qty_reserved ?? 0),
      unit_price: Number(l.unit_price),
      discount_pct: Number(l.discount_pct ?? 0),
      vat_rate: Number(l.vat_rate),
      line_subtotal: Number(l.line_subtotal ?? 0),
      line_vat: Number(l.line_vat ?? 0),
      line_total: Number(l.line_total),
    };
  }
}
