export const dynamic = 'force-dynamic';
import { type NextRequest } from 'next/server';
import { query, getPool } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { ok, err } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get('company_id');
  if (!companyId) return err('company_id is required', 400);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const params: unknown[] = [companyId];
  let where = `gr.company_id = $1`;

  const poId = searchParams.get('po_id');
  if (poId) { params.push(poId); where += ` AND gr.po_id = $${params.length}`; }

  params.push(limit, offset);

  const rows = await query(
    `SELECT gr.id, gr.grn_no, gr.receipt_date, gr.delivery_no, gr.notes, gr.status,
            po.po_no, s.name AS supplier_name
       FROM goods_receipts gr
       JOIN purchase_orders po ON po.id = gr.po_id
       JOIN suppliers s        ON s.id  = po.supplier_id
      WHERE ${where}
      ORDER BY gr.receipt_date DESC, gr.grn_no DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countRows = await query<{ c: number }>(
    `SELECT count(*)::int AS c FROM goods_receipts gr WHERE ${where}`,
    params.slice(0, params.length - 2),
  );

  return ok({
    data: rows,
    total: countRows[0].c,
    page: Math.floor(offset / limit) + 1,
    page_size: limit,
  });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireAuth>>;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return e as Response;
  }

  let dto: Record<string, unknown>;
  try {
    dto = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const lines = dto.lines as Array<Record<string, unknown>>;
  if (!lines?.length) return err('GRN must have at least one line', 400);

  const companyId = dto.company_id as string;
  const poId = dto.po_id as string;
  if (!companyId || !poId) return err('company_id and po_id are required', 400);

  const poRows = await query(
    `SELECT id, status FROM purchase_orders WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [poId, companyId],
  );
  if (!poRows[0]) return err('Purchase order not found', 404);
  const po = poRows[0] as Record<string, unknown>;
  if (!['approved','partial'].includes(po.status as string)) {
    return err(`PO must be approved or partial to receive goods (current: ${po.status})`, 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const seqRows = await client.query(
      `SELECT COUNT(*)::int AS c FROM goods_receipts WHERE company_id = $1`,
      [companyId],
    );
    const seq = seqRows.rows[0].c + 1;
    const grnNo = `GRN-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;

    const headerRows = await client.query(
      `INSERT INTO goods_receipts
         (company_id, grn_no, po_id, warehouse_id, receipt_date, delivery_no, notes,
          branch_id, building_id, cost_center_id, grow_reference_id,
          status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'posted',$12)
       RETURNING *`,
      [
        companyId, grnNo, poId,
        (dto.warehouse_id as string) || null,
        dto.receipt_date,
        (dto.delivery_no as string) || null,
        (dto.notes as string) || null,
        (dto.branch_id as string) || null,
        (dto.building_id as string) || null,
        (dto.cost_center_id as string) || null,
        (dto.grow_reference_id as string) || null,
        auth.userId,
      ],
    );
    const header = headerRows.rows[0];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as Record<string, unknown>;
      const qtyReceived = Number(l.qty_received);
      const unitCost = Number(l.unit_cost ?? 0);
      if (qtyReceived <= 0) continue;

      await client.query(
        `INSERT INTO goods_receipt_lines
           (grn_id, po_line_id, line_no, qty_received, unit_cost,
            branch_id, building_id, cost_center_id, grow_reference_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          header.id, l.po_line_id, i + 1, qtyReceived, unitCost,
          (l.branch_id as string) || null,
          (l.building_id as string) || null,
          (l.cost_center_id as string) || null,
          (l.grow_reference_id as string) || null,
        ],
      );

      await client.query(
        `UPDATE purchase_order_lines
            SET qty_received = qty_received + $1
          WHERE id = $2`,
        [qtyReceived, l.po_line_id],
      );

      // Resolve item_id from PO line for stock updates
      const polItemRows = await client.query<{ item_id: string }>(
        `SELECT item_id FROM purchase_order_lines WHERE id = $1 LIMIT 1`,
        [l.po_line_id],
      );
      const itemId = polItemRows.rows[0]?.item_id ?? null;
      const warehouseId = (dto.warehouse_id as string) || null;

      if (itemId && warehouseId) {
        // Weighted-average cost update
        await client.query(
          `INSERT INTO stock_balances (item_id, warehouse_id, qty_on_hand, avg_cost, last_movement_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (item_id, warehouse_id) DO UPDATE
             SET avg_cost = CASE
                   WHEN stock_balances.qty_on_hand + $3 > 0
                   THEN (stock_balances.qty_on_hand * stock_balances.avg_cost + $3 * $4)
                          / (stock_balances.qty_on_hand + $3)
                   ELSE $4
                 END,
                 qty_on_hand = stock_balances.qty_on_hand + $3,
                 last_movement_at = now()`,
          [itemId, warehouseId, qtyReceived, unitCost],
        );

        await client.query(
          `INSERT INTO stock_movements
             (company_id, item_id, warehouse_id, movement_type, quantity, unit_cost, total_cost,
              reference_type, reference_id, reference_no, created_by)
           VALUES ($1,$2,$3,'receipt',$4,$5,$6,'goods_receipt',$7,$8,$9)`,
          [
            companyId, itemId, warehouseId,
            qtyReceived, unitCost, qtyReceived * unitCost,
            header.id, grnNo, auth.userId,
          ],
        );
      }
    }

    // Update PO status based on receipt totals
    await client.query(
      `UPDATE purchase_orders po
          SET status = CASE
            WHEN (SELECT SUM(pol.qty_received) FROM purchase_order_lines pol WHERE pol.po_id = po.id)
                  >= (SELECT SUM(pol.quantity) FROM purchase_order_lines pol WHERE pol.po_id = po.id)
            THEN 'received'
            ELSE 'partial'
          END,
          updated_at = now()
        WHERE id = $1`,
      [poId],
    );

    await client.query(
      `UPDATE goods_receipts SET posted_at = now() WHERE id = $1`,
      [header.id],
    );

    // ── Journal Entry: DR Inventory/Asset, CR GRNI or Advances to Suppliers ──
    const periodRows = await client.query(
      `SELECT id, status FROM fiscal_periods
        WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date LIMIT 1`,
      [companyId, dto.receipt_date],
    );
    const period = periodRows.rows[0] as Record<string, unknown> | null ?? null;

    if (period && period.status !== 'closed') {
      // GRNI credit account
      const grniRows = await client.query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (name ILIKE '%grni%' OR name ILIKE '%goods received not yet%' OR code ILIKE '%grni%')
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [companyId],
      );
      const grniAccountId: string | null = grniRows.rows[0]?.id ?? null;

      // Advances to Suppliers account (used when PO already has a bill)
      const advRows = await client.query(
        `SELECT id FROM accounts
          WHERE company_id = $1
            AND (code = '11021'
                 OR name ILIKE '%advances to supplier%'
                 OR (name ILIKE '%advance%' AND name ILIKE '%supplier%'))
            AND is_active = true
          ORDER BY code LIMIT 1`,
        [companyId],
      );
      const advancesAccountId: string | null = advRows.rows[0]?.id ?? null;

      // If PO already has any bill → credit Advances to Suppliers to close the advance
      const billCountRows = await client.query(
        `SELECT COUNT(*)::int AS c FROM bills WHERE po_id = $1 AND status IN ('draft','approved','partial','pending_approval')`,
        [poId],
      );
      const poHasBill = Number((billCountRows.rows[0] as Record<string, unknown>).c) > 0;

      const creditAccountId = (poHasBill && advancesAccountId) ? advancesAccountId : grniAccountId;
      const creditDescription = (poHasBill && advancesAccountId)
        ? `Clear Advance to Supplier — ${grnNo}`
        : `GRNI — ${grnNo}`;

      // Default asset/inventory account fallback for lines with no specific account
      const defAssetRows = await client.query(
        `SELECT id FROM accounts
          WHERE company_id = $1 AND is_active = true
            AND (name ILIKE '%inventor%' OR name ILIKE '%raw material%' OR name ILIKE '%merchandise%')
            AND account_type IN ('ASSET','asset')
          ORDER BY code LIMIT 1`,
        [companyId],
      );
      // Secondary fallback: any asset account
      const defAsset2Rows = defAssetRows.rows[0]?.id ? null : await client.query(
        `SELECT id FROM accounts WHERE company_id = $1 AND account_type IN ('ASSET','asset') AND is_active = true ORDER BY code LIMIT 1`,
        [companyId],
      );
      const defaultAssetAccountId: string | null = defAssetRows.rows[0]?.id ?? defAsset2Rows?.rows[0]?.id ?? null;

      // Resync the series past any existing entry_no before issuing, so we never
      // collide with journal_entries.entry_no. The series counter can lag behind
      // the real max (e.g. after seeds/migrations that insert JEs directly), which
      // causes a duplicate-key error on journal_entries_company_id_entry_no_key.
      // We take the numeric suffix that follows the prefix on existing entries.
      const seriesRows = await client.query<{ prefix: string; current_number: string }>(
        `UPDATE document_series ds
            SET current_number = GREATEST(
                  ds.current_number,
                  COALESCE((
                    SELECT MAX(NULLIF(regexp_replace(substr(je.entry_no, length(ds.prefix) + 1), '\\D', '', 'g'), '')::bigint)
                      FROM journal_entries je
                     WHERE je.company_id = ds.company_id
                       AND je.entry_no LIKE ds.prefix || '%'
                  ), 0)
                ) + 1,
                updated_at = now()
          WHERE ds.company_id = $1 AND ds.doc_type = 'journal_voucher' AND ds.is_active = true
          RETURNING prefix, current_number`,
        [companyId],
      );

      if (creditAccountId && seriesRows.rows[0]) {
        const jeNo = `${seriesRows.rows[0].prefix}${String(Number(seriesRows.rows[0].current_number)).padStart(6, '0')}`;

        const grnLineDetails = await client.query(
          `SELECT grl.qty_received, grl.unit_cost, grl.line_no,
                  i.inventory_account_id AS asset_account_id,
                  pol.description
             FROM goods_receipt_lines grl
             JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
             LEFT JOIN items i ON i.id = pol.item_id
            WHERE grl.grn_id = $1
            ORDER BY grl.line_no`,
          [header.id],
        );

        const jeRows = await client.query(
          `INSERT INTO journal_entries
             (company_id, branch_id, entry_no, entry_date, fiscal_period_id, reference, memo,
              source_module, source_doc_type, source_doc_id, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'purchasing','goods_receipt',$8,'posted',$9)
           RETURNING id`,
          [
            companyId, (dto.branch_id as string) || null, jeNo,
            dto.receipt_date, period.id, grnNo,
            `GRN ${grnNo}`,
            header.id, auth.userId,
          ],
        );
        const jeId = jeRows.rows[0].id as string;

        let jeLineNo = 1;
        let totalAmount = 0;

        for (const l of grnLineDetails.rows as Array<Record<string, unknown>>) {
          const amount = parseFloat((Number(l.qty_received) * Number(l.unit_cost)).toFixed(2));
          if (amount <= 0) continue;
          // Use line-specific account or fall back to default asset account
          const acctId = (l.asset_account_id as string | null) ?? defaultAssetAccountId;
          if (!acctId) continue;
          totalAmount = parseFloat((totalAmount + amount).toFixed(2));
          await client.query(
            `INSERT INTO journal_entry_lines
               (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
             VALUES ($1,$2,$3,$4,$5,0,'PHP',1,$5,0)`,
            [jeId, jeLineNo++, acctId, String(l.description), amount],
          );
        }

        if (totalAmount > 0) {
          await client.query(
            `INSERT INTO journal_entry_lines
               (entry_id, line_no, account_id, description, debit, credit, currency, fx_rate, base_debit, base_credit)
             VALUES ($1,$2,$3,$4,0,$5,'PHP',1,0,$5)`,
            [jeId, jeLineNo, creditAccountId, creditDescription, totalAmount],
          );

          await client.query(
            `INSERT INTO account_balances (account_id, fiscal_period_id, debit_total, credit_total)
             SELECT jel.account_id, $2, jel.debit, jel.credit
               FROM journal_entry_lines jel WHERE jel.entry_id = $1
             ON CONFLICT (account_id, fiscal_period_id) DO UPDATE
               SET debit_total  = account_balances.debit_total  + EXCLUDED.debit_total,
                   credit_total = account_balances.credit_total + EXCLUDED.credit_total`,
            [jeId, period.id],
          );

          await client.query(
            `UPDATE journal_entries SET posted_at = now(), posted_by = $2 WHERE id = $1`,
            [jeId, auth.userId],
          );

          await client.query(
            `UPDATE goods_receipts SET je_id = $2 WHERE id = $1`,
            [header.id, jeId],
          ).catch(() => {}); // no-op if column not yet migrated
        } else {
          // No postable lines — remove the empty JE header
          await client.query(`DELETE FROM journal_entries WHERE id = $1`, [jeId]);
          // Restore document series counter
          await client.query(
            `UPDATE document_series SET current_number = current_number - 1
              WHERE company_id = $1 AND doc_type = 'journal_voucher'`,
            [companyId],
          );
        }
      }
    }

    // Auto-create chick batches for each GRN line
    const { rows: cntRows } = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM chick_batches WHERE company_id = $1`, [companyId]);
    let batchSeq = cntRows[0].c;
    const year = new Date(dto.receipt_date as string || new Date().toISOString()).getFullYear();

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i] as Record<string, unknown>;
      const qty = Number(l.qty_received);
      if (qty <= 0) continue;

      // Get item_id from the PO line
      const { rows: polRows } = await client.query<{ item_id: string }>(
        `SELECT item_id FROM purchase_order_lines WHERE id = $1 LIMIT 1`, [l.po_line_id]);
      if (!polRows[0]) continue;

      batchSeq += 1;
      const batchNo = `BATCH-${year}-${String(batchSeq).padStart(5, '0')}`;
      const grnLineRows = await client.query(
        `SELECT id FROM goods_receipt_lines WHERE grn_id = $1 AND line_no = $2 LIMIT 1`,
        [header.id, i + 1]);
      const grnLineId = grnLineRows.rows[0]?.id ?? null;

      await client.query(
        `INSERT INTO chick_batches
           (company_id, batch_no, grn_id, grn_line_id, po_id, item_id,
            heads_in, heads_available, price_per_head, date_received, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'available')
         ON CONFLICT DO NOTHING`,
        [companyId, batchNo, header.id, grnLineId, poId,
         polRows[0].item_id, qty, Number(l.unit_cost ?? 0),
         dto.receipt_date],
      );
    }

    await client.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.userId, companyId, 'create', 'goods_receipt', header.id],
    ).catch(() => {});

    await client.query('COMMIT');

    const fullRows = await query(
      `SELECT gr.*, po.po_no, s.name AS supplier_name
         FROM goods_receipts gr
         JOIN purchase_orders po ON po.id = gr.po_id
         JOIN suppliers s ON s.id = po.supplier_id
        WHERE gr.id = $1 LIMIT 1`,
      [header.id],
    );
    const grnLines = await query(
      `SELECT grl.*, pol.description, pol.unit_price
         FROM goods_receipt_lines grl
         JOIN purchase_order_lines pol ON pol.id = grl.po_line_id
        WHERE grl.grn_id = $1
        ORDER BY grl.line_no`,
      [header.id],
    );

    return ok({ ...fullRows[0], lines: grnLines }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return err((e as Error).message ?? 'Unknown error', 500);
  } finally {
    client.release();
  }
}
