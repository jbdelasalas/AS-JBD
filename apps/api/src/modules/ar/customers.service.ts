import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Customer, CreateCustomerDto, UpdateCustomerDto } from '@perpet/shared';
import { AuditLogService } from '../common/audit-log.service';

@Injectable()
export class CustomersService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(
    companyId: string,
    opts: { search?: string; is_active?: boolean; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const params: unknown[] = [companyId];
    let where = `c.company_id = $1`;

    if (opts.search) {
      params.push(`%${opts.search}%`);
      where += ` AND (c.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`;
    }
    if (opts.is_active !== undefined) {
      params.push(opts.is_active);
      where += ` AND c.is_active = $${params.length}`;
    }

    params.push(limit, offset);
    const rows = await this.ds.query(
      `SELECT c.*,
              COALESCE(SUM(si.balance), 0) AS open_ar_balance
         FROM customers c
         LEFT JOIN sales_invoices si ON si.customer_id = c.id
           AND si.status IN ('open','partially_paid','overdue')
        WHERE ${where}
        GROUP BY c.id
        ORDER BY c.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countRows = await this.ds.query(
      `SELECT count(*)::int AS c FROM customers c WHERE ${where}`,
      params.slice(0, params.length - 2),
    );

    return {
      data: rows.map((r: Record<string, unknown>) => ({
        ...r,
        credit_limit: Number(r.credit_limit),
        open_ar_balance: Number(r.open_ar_balance),
      })),
      total: countRows[0].c,
      page: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  async findById(id: string): Promise<Customer & { open_ar_balance: number }> {
    const rows = await this.ds.query(
      `SELECT c.*,
              COALESCE(SUM(si.balance), 0) AS open_ar_balance
         FROM customers c
         LEFT JOIN sales_invoices si ON si.customer_id = c.id
           AND si.status IN ('open','partially_paid','overdue')
        WHERE c.id = $1
        GROUP BY c.id`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`Customer ${id} not found`);
    const r = rows[0];
    return { ...r, credit_limit: Number(r.credit_limit), open_ar_balance: Number(r.open_ar_balance) };
  }

  private async nextCustomerCode(companyId: string): Promise<string> {
    const rows = await this.ds.query(
      `SELECT COUNT(*)::int AS c FROM customers WHERE company_id = $1`,
      [companyId],
    ) as Array<{ c: number }>;
    const seq = rows[0].c + 1;
    return `CUST-${String(seq).padStart(6, '0')}`;
  }

  async create(dto: CreateCustomerDto, userId: string): Promise<Customer> {
    const code = await this.nextCustomerCode(dto.company_id);

    const existing = await this.ds.query(
      `SELECT id FROM customers WHERE company_id = $1 AND code = $2`,
      [dto.company_id, code],
    );
    if (existing.length) throw new ConflictException(`Customer code ${code} already exists`);

    const rows = await this.ds.query(
      `INSERT INTO customers
         (company_id, code, name, customer_type, tin, address, contact_person,
          email, phone, payment_terms_days, credit_limit, is_vat_exempt, ar_account_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        dto.company_id,
        code,
        dto.name,
        dto.customer_type ?? 'wholesale',
        dto.tin ?? null,
        dto.address ?? null,
        dto.contact_person ?? null,
        dto.email ?? null,
        dto.phone ?? null,
        dto.payment_terms_days ?? 30,
        dto.credit_limit ?? 0,
        dto.is_vat_exempt ?? false,
        dto.ar_account_id ?? null,
        userId,
      ],
    );
    const customer = rows[0];

    await this.audit.record({
      userId,
      companyId: dto.company_id,
      action: 'create',
      entityType: 'customer',
      entityId: customer.id,
      afterState: customer,
    });

    return { ...customer, credit_limit: Number(customer.credit_limit) };
  }

  async update(id: string, dto: UpdateCustomerDto, userId: string): Promise<Customer> {
    const customer = await this.findById(id);
    const before = { ...customer };

    const sets: string[] = [];
    const params: unknown[] = [];

    const updatable: (keyof UpdateCustomerDto)[] = [
      'name', 'customer_type', 'tin', 'address', 'contact_person',
      'email', 'phone', 'payment_terms_days', 'credit_limit',
      'is_vat_exempt', 'ar_account_id',
    ];

    for (const key of updatable) {
      if (dto[key] !== undefined) {
        params.push(dto[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }

    if ('is_active' in dto) {
      params.push((dto as { is_active?: boolean }).is_active);
      sets.push(`is_active = $${params.length}`);
    }

    if (!sets.length) return customer;

    params.push(id);
    await this.ds.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    await this.audit.record({
      userId,
      companyId: customer.company_id,
      action: 'update',
      entityType: 'customer',
      entityId: id,
      beforeState: before,
      afterState: dto,
    });

    return this.findById(id);
  }

  async checkCreditLimit(
    customerId: string,
    newOrderAmount: number,
  ): Promise<{ ok: boolean; available: number; used: number; limit: number }> {
    const rows = await this.ds.query(
      `SELECT c.credit_limit,
              COALESCE(SUM(si.balance), 0) AS open_ar
         FROM customers c
         LEFT JOIN sales_invoices si ON si.customer_id = c.id
           AND si.status IN ('open','partially_paid','overdue')
        WHERE c.id = $1
        GROUP BY c.id`,
      [customerId],
    );
    if (!rows[0]) throw new NotFoundException(`Customer ${customerId} not found`);

    const limit = Number(rows[0].credit_limit);
    const used = Number(rows[0].open_ar);
    const available = limit - used;

    return {
      ok: limit === 0 || (used + newOrderAmount) <= limit,
      available,
      used,
      limit,
    };
  }

  async getOutstandingInvoices(customerId: string) {
    return this.ds.query(
      `SELECT id, invoice_no, invoice_date, due_date, total, amount_paid, balance, status
         FROM sales_invoices
        WHERE customer_id = $1
          AND status IN ('open','partially_paid','overdue')
        ORDER BY due_date ASC`,
      [customerId],
    );
  }
}
