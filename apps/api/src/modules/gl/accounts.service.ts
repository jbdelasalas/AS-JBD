import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AccountTypeCode } from '@perpet/shared';

import { AuditLogService } from '../common/audit-log.service';

export interface CreateAccountInput {
  company_id: string;
  code: string;
  name: string;
  account_type: AccountTypeCode;
  parent_id?: string | null;
  currency?: string;
  is_control?: boolean;
  description?: string | null;
}

@Injectable()
export class AccountsService {
  constructor(private readonly ds: DataSource, private readonly audit: AuditLogService) {}

  async list(companyId: string, opts: { activeOnly?: boolean; type?: AccountTypeCode } = {}) {
    const params: unknown[] = [companyId];
    let where = `company_id = $1`;
    if (opts.activeOnly) where += ` AND is_active = true`;
    if (opts.type) {
      params.push(opts.type);
      where += ` AND account_type = $${params.length}`;
    }
    return this.ds.query(
      `SELECT id, code, name, account_type, parent_id, currency, is_active, is_control, description
         FROM accounts
        WHERE ${where}
        ORDER BY code`,
      params,
    );
  }

  async findById(id: string) {
    const rows = await this.ds.query(
      `SELECT id, company_id, code, name, account_type, parent_id, currency, is_active, is_control, description
         FROM accounts WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`Account ${id} not found`);
    return rows[0];
  }

  async create(input: CreateAccountInput, userId: string) {
    // Check uniqueness within company
    const dup = await this.ds.query(
      `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
      [input.company_id, input.code],
    );
    if (dup[0]) throw new ConflictException(`Account code ${input.code} already exists`);

    const rows = await this.ds.query(
      `INSERT INTO accounts (company_id, code, name, account_type, parent_id, currency, is_control, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code, name, account_type, parent_id, currency, is_active, is_control, description`,
      [
        input.company_id,
        input.code,
        input.name,
        input.account_type,
        input.parent_id ?? null,
        input.currency ?? 'PHP',
        input.is_control ?? false,
        input.description ?? null,
      ],
    );
    const created = rows[0];
    await this.audit.record({
      userId,
      companyId: input.company_id,
      action: 'create',
      entityType: 'account',
      entityId: created.id,
      afterState: created,
    });
    return created;
  }
}
