import { SetMetadata, CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PERMISSIONS_KEY = 'required_permissions';

/** Decorator: @RequirePermissions('gl.journal.post') */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { permissions?: string[]; isSuperadmin?: boolean } | undefined;

    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.isSuperadmin) return true;

    const granted = user.permissions ?? [];
    const ok = required.every((p) => granted.includes(p));
    if (!ok) {
      throw new ForbiddenException(`Missing permission: ${required.join(', ')}`);
    }
    return true;
  }
}
