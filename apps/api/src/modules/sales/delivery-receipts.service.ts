import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DeliveryReceipt, CreateDeliveryReceiptDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class DeliveryReceiptsService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(
    companyId: string,
    opts: { so_id?: string; status?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `dr.company_id = $1`;

    if (opts.so_id) { params.push(opts.so_id); where += ` AND dr.so_id = $${params.length}`; }
    if (opts.status) { params.push(opts.status); where += ` AND dr.status = $${params.length}`; }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT dr.id, dr.dr_no, dr.delivery_date, dr.status, dr.posted_at,
              c.name AS customer_name, so.order_no, w.name AS warehouse_name
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
        WHERE ${where}
        ORDER BY dr.delivery_date DESC, dr.dr_no DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM delivery_receipts dr WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows,
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<DeliveryReceipt> {
    const headers = await this.ds.query(
      `SELECT dr.*, c.name AS customer_name, so.order_no, w.name AS warehouse_name
         FROM delivery_receipts dr
         JOIN customers c ON c.id = dr.customer_id
         JOIN sales_orders so ON so.id = dr.so_id
         JOIN warehouses w ON w.id = dr.warehouse_id
        WHERE dr.id = $1 LIMIT 1`,
      [id],
    );
    if (!headers[0]) throw new NotFoundException(`Delivery receipt ${id} not found`);

    const lines = await this.ds.query(
      `SELECT drl.*, i.sku AS item_sku, i.name AS item_name
         FROM delivery_receipt_lines drl
         JOIN items i ON i.id = drl.item_id
        WHERE drl.dr_id = $1
        ORDER BY drl.line_no`,
      [id],
    );

    return {
      ...headers[0],
      lines: lines.map((l: Record<string, unknown>) => ({
        ...l,
        qty_delivered: Number(l.qty_delivered),
        unit_cost: Number(l.unit_cost),
      })),
    };
  }

  async create(dto: CreateDeliveryReceiptDto, userId: string): Promise<DeliveryReceipt> {
    if (!dto.lines?.length) throw new BadRequestException('Delivery receipt must have at least one line');

    // Validate SO
    const soRows = await this.ds.query(
      `SELECT so.*, c.id AS cust_id FROM sales_orders so
         JOIN customers c ON c.id = so.customer_id
        WHERE so.id = $1 AND so.company_id = $2`,
      [dto.so_id, dto.company_id],
    );
    if (!soRows[0]) throw new NotFoundException('Sales order not found');
    const so = soRows[0];

    if (!['approved', 'partially_delivered'].includes(so.status)) {
      throw new BadRequestException(`Cannot create DR for SO in status: ${so.status}`);
    }

    // Validate qty against SO lines
    const soLines = await this.ds.query(
      `SELECT id, item_id, quantity, qty_delivered FROM sales_order_lines WHERE order_id = $1`,
      [dto.so_id],
    );

    for (const drLine of dto.lines) {
      if (drLine.so_line_id) {
        const soLine = soLines.find((l: { id: string }) => l.id === drLine.so_line_id);
        if (!soLine) throw new BadRequestException(`SO line ${drLine.so_line_id} not found`);
        const remaining = Number(soLine.quantity) - Number(soLine.qty_delivered);
        if (drLine.qty_delivered > remaining + 0.0001) {
          throw new BadRequestException(
            `Qty to deliver (${drLine.qty_delivered}) exceeds remaining (${remaining.toFixed(4)})`,
          );
        }
      }
    }

    return this.ds.transaction(async (tx) => {
      const drNo = await this.nextDocNo(tx, dto.company_id, 'delivery_receipt');

      // Get unit costs from stock balances
      const itemIds = dto.lines.map((l) => l.item_id);
      const stockRows = await tx.query(
        `SELECT item_id, avg_cost FROM stock_balances
          WHERE item_id = ANY($1) AND warehouse_id = $2`,
        [itemIds, dto.warehouse_id],
      );
      const costMap = new Map(
        (stockRows as Array<{ item_id: string; avg_cost: string }>).map((r) => [r.item_id, Number(r.avg_cost)]),
      );

      const headerRows = await tx.query(
        `INSERT INTO delivery_receipts
           (company_id, branch_id, dr_no, so_id, customer_id, warehouse_id,
            delivery_date, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9)
         RETURNING *`,
        [
          dto.company_id, dto.branch_id ?? null, drNo, dto.so_id,
          so.customer_id, dto.warehouse_id, dto.delivery_date,
          dto.notes ?? null, userId,
        ],
      );
      const header = headerRows[0];

      for (let i = 0; i < dto.lines.length; i++) {
        const l = dto.lines[i];
        const unitCost = costMap.get(l.item_id) ?? 0;
        const itemRow = await tx.query(
          `SELECT name FROM items WHERE id = $1 LIMIT 1`, [l.item_id],
        );
        await tx.query(
          `INSERT INTO delivery_receipt_lines
             (dr_id, so_line_id, line_no, item_id, description, qty_delivered, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            header.id, l.so_line_id ?? null, i + 1, l.item_id,
            l.description ?? (itemRow[0] as { name: string })?.name ?? '',
            l.qty_delivered, unitCost,
          ],
        );
      }

      await this.audit.record({
        userId, companyId: dto.company_id,
        action: 'create', entityType: 'delivery_receipt', entityId: header.id,
        afterState: { dr_no: drNo, so_id: dto.so_id },
      });

      return this.findById(header.id);
    });
  }

  async post(id: string, userId: string): Promise<DeliveryReceipt> {
    return this.ds.transaction(async (tx) => {
      const rows = await tx.query(
        `SELECT dr.*, so.company_id FROM delivery_receipts dr
           JOIN sales_orders so ON so.id = dr.so_id
          WHERE dr.id = $1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`DR ${id} not found`);
      const dr = rows[0] as Record<string, unknown>;
      if (dr.status !== 'draft') throw new ConflictException(`DR is already ${dr.status}`);

      const lines = await tx.query(
        `SELECT drl.item_id, drl.qty_delivered, drl.unit_cost,
                drl.so_line_id, i.name AS item_name
           FROM delivery_receipt_lines drl
           JOIN items i ON i.id = drl.item_id
          WHERE drl.dr_id = $1`,
        [id],
      );

      for (const line of lines as Array<Record<string, unknown>>) {
        const qty = Number(line.qty_delivered);
        const cost = Number(line.unit_cost);

        // Decrement stock
        await tx.query(
          `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (item_id, warehouse_id) DO UPDATE
             SET qty_on_hand = stock_balances.qty_on_hand - $3,
                 last_movement_at = now()`,
          [line.item_id, dr.warehouse_id, qty, cost],
        );

        // Stock movement record
        await tx.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost,
              total_cost, reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'sale',$4,$5,$6,'delivery_receipt',$7,$8,$9)`,
          [
            dr.company_id, line.item_id, dr.warehouse_id,
            -qty, cost, -(qty * cost),
            id, dr.dr_no, userId,
          ],
        );

        // Update SO line delivered qty
        if (line.so_line_id) {
          await tx.query(
            `UPDATE sales_order_lines
               SET qty_delivered = qty_delivered + $2,
                   qty_reserved  = GREATEST(qty_reserved - $2, 0)
             WHERE id = $1`,
            [line.so_line_id, qty],
          );
        }

        // Release reservation
        await tx.query(
          `UPDATE inventory_reservations
             SET qty_reserved = GREATEST(qty_reserved - $2, 0)
           WHERE so_line_id = $1`,
          [line.so_line_id, qty],
        );
      }

      // Update SO delivery status
      const soStatusRows = await tx.query(
        `SELECT
           SUM(quantity) AS total_qty,
           SUM(qty_delivered) AS delivered_qty
         FROM sales_order_lines WHERE order_id = $1`,
        [dr.so_id],
      );
      const totalQty = Number(soStatusRows[0].total_qty ?? 0);
      const deliveredQty = Number(soStatusRows[0].delivered_qty ?? 0);
      const newSoStatus =
        deliveredQty >= totalQty - 0.0001
          ? 'fully_delivered'
          : deliveredQty > 0
          ? 'partially_delivered'
          : 'approved';

      await tx.query(
        `UPDATE sales_orders SET status = $2 WHERE id = $1`,
        [dr.so_id, newSoStatus],
      );

      await tx.query(
        `UPDATE delivery_receipts SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`,
        [id, userId],
      );

      await this.audit.record({
        userId, companyId: dr.company_id as string,
        action: 'post', entityType: 'delivery_receipt', entityId: id,
      });

      return this.findById(id);
    });
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
}
