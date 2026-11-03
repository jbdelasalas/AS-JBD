// Module-confined roles: warehouse staff and dressing-plant staff.
//
// A user whose permissions are ALL module-access permissions (see SCOPES) is
// confined to those modules: the sidebar shows only them, the dashboard layout
// redirects anywhere else, and middleware rejects API calls outside them — that
// last one is the real boundary, since most routes only check sign-in.
// Pure (no window / no Node APIs) so the Edge middleware can import it.

export const WMS_ACCESS = 'wms.access';
export const DP_ACCESS = 'dressing_plant.access';
export const LABEL_PRINT_PERMISSION = 'dressing_plant.label.print';

interface ApiRule { prefix: string; methods?: string[] }
interface Scope { home: string; pages: string[]; api: ApiRule[] }

const GET = ['GET'];

const SCOPES: Record<string, Scope> = {
  [WMS_ACCESS]: {
    home: '/dashboard/wms',
    pages: ['/dashboard/wms'],
    api: [{ prefix: '/api/v1/wms/' }],
  },
  [DP_ACCESS]: {
    home: '/dashboard/dressing-plant',
    pages: ['/dashboard/dressing-plant'],
    api: [
      { prefix: '/api/v1/dressing-plant/' },
      // Lookups the dressing-plant screens read from other modules.
      { prefix: '/api/v1/wms/items', methods: GET },
      { prefix: '/api/v1/ar/customers', methods: GET },
    ],
  },
  // Only matters combined with a module role; label-only users keep their own
  // handling (isLabelOnlyUser).
  [LABEL_PRINT_PERMISSION]: {
    home: '/dashboard/dressing-plant/labels',
    pages: ['/dashboard/dressing-plant/labels'],
    api: [
      { prefix: '/api/v1/dressing-plant/label-lots' },
      { prefix: '/api/v1/dressing-plant/facilities', methods: GET },
      { prefix: '/api/v1/dressing-plant/sizes', methods: GET },
    ],
  },
};

// What every page needs regardless of module (layout, branding, login routing).
const SHARED_API: ApiRule[] = [
  { prefix: '/api/v1/flags', methods: GET },
  { prefix: '/api/v1/settings', methods: GET },
  { prefix: '/api/v1/admin/field-requirements', methods: GET },
  { prefix: '/api/v1/portal/me', methods: GET },
];

/**
 * The scopes a user is confined to, or null when they are not confined
 * (superadmin, no permissions, any permission outside SCOPES, or label-only).
 */
export function confinedScopes(permissions: string[], isSuperadmin: boolean): string[] | null {
  if (isSuperadmin || !permissions.length) return null;
  if (!permissions.every((p) => p in SCOPES)) return null;
  if (!permissions.some((p) => p === WMS_ACCESS || p === DP_ACCESS)) return null;
  return [...new Set(permissions)];
}

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');

export function scopeHome(scopes: string[]): string {
  const main = scopes.find((s) => s === WMS_ACCESS || s === DP_ACCESS) ?? scopes[0];
  return SCOPES[main].home;
}

export function pageAllowed(scopes: string[], pathname: string): boolean {
  return scopes.some((s) => SCOPES[s].pages.some((p) => under(pathname, p)));
}

export function apiAllowed(scopes: string[], pathname: string, method: string): boolean {
  const rules = [...SHARED_API, ...scopes.flatMap((s) => SCOPES[s].api)];
  return rules.some((r) => under(pathname, r.prefix) && (!r.methods || r.methods.includes(method)));
}
