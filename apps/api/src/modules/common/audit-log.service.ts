import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditEvent {
  userId?: string | null;
  companyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly ds: DataSource) {}

  async record(evt: AuditEvent): Promise<void> {
    await this.ds.query(
      `INSERT INTO audit_log
        (user_id, company_id, action, entity_type, entity_id,
         before_state, after_state, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        evt.userId ?? null,
        evt.companyId ?? null,
        evt.action,
        evt.entityType,
        evt.entityId ?? null,
        evt.beforeState ? JSON.stringify(evt.beforeState) : null,
        evt.afterState ? JSON.stringify(evt.afterState) : null,
        evt.ipAddress ?? null,
        evt.userAgent ?? null,
      ],
    );
  }
}
