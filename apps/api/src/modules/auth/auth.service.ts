import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { AuditLogService } from '../common/audit-log.service';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: boolean;
  is_superadmin: boolean;
  twofa_enabled: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly ds: DataSource,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly audit: AuditLogService,
  ) {}

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const rows: UserRow[] = await this.ds.query(
      `SELECT id, email, password_hash, full_name, is_active, is_superadmin, twofa_enabled
         FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      // do NOT distinguish between unknown email and inactive user — same error
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Permissions
    const permissions = await this.getPermissions(user.id);

    // Companies the user belongs to
    const companies: Array<{ id: string; code: string; name: string }> = await this.ds.query(
      `SELECT DISTINCT c.id, c.code, c.name
         FROM companies c
         LEFT JOIN user_roles ur ON ur.company_id = c.id
        WHERE c.is_active
          AND ($1 OR ur.user_id = $2)
        ORDER BY c.name`,
      [user.is_superadmin, user.id],
    );

    // Tokens
    const accessToken = await this.signAccess(user, permissions);
    const refreshToken = await this.issueRefreshToken(user.id);

    // Update last_login
    await this.ds.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    await this.audit.record({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: ip,
      userAgent,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.parseExpiryToSeconds(this.cfg.get('JWT_ACCESS_EXPIRES', '15m')),
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active,
        is_superadmin: user.is_superadmin,
        twofa_enabled: user.twofa_enabled,
      },
      permissions,
      companies,
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const rows = await this.ds.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.is_active, u.is_superadmin, u.email
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.revoked_at) throw new UnauthorizedException('Refresh token revoked');
    if (new Date(row.expires_at) < new Date()) throw new UnauthorizedException('Refresh token expired');
    if (!row.is_active) throw new UnauthorizedException('User inactive');

    // Rotate: revoke this one, issue new
    await this.ds.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
    const permissions = await this.getPermissions(row.user_id);
    const newAccess = await this.signAccess(
      { id: row.user_id, email: row.email, is_superadmin: row.is_superadmin } as UserRow,
      permissions,
    );
    const newRefresh = await this.issueRefreshToken(row.user_id);
    return {
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_in: this.parseExpiryToSeconds(this.cfg.get('JWT_ACCESS_EXPIRES', '15m')),
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const hash = this.hashToken(refreshToken);
      await this.ds.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [hash, userId],
      );
    }
  }

  private async signAccess(user: UserRow, permissions: string[]): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      isSuperadmin: user.is_superadmin,
      permissions,
    });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(48).toString('hex');
    const hash = this.hashToken(raw);
    const expires = new Date();
    const days = this.parseDaysFromExpires(this.cfg.get('JWT_REFRESH_EXPIRES', '7d'));
    expires.setDate(expires.getDate() + days);
    await this.ds.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, hash, expires],
    );
    return raw;
  }

  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async getPermissions(userId: string): Promise<string[]> {
    const rows = await this.ds.query(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = $1`,
      [userId],
    );
    return rows.map((r: { code: string }) => r.code);
  }

  private parseExpiryToSeconds(expr: string): number {
    const m = /^(\d+)([smhd])$/.exec(expr);
    if (!m) return 900;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    return unit === 's' ? n : unit === 'm' ? n * 60 : unit === 'h' ? n * 3600 : n * 86400;
  }

  private parseDaysFromExpires(expr: string): number {
    const m = /^(\d+)d$/.exec(expr);
    return m ? parseInt(m[1], 10) : 7;
  }
}
