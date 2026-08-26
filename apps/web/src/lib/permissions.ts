// Client-side view of what the signed-in user may reach.
//
// This is presentation only — it decides which doors to *show*. Every endpoint
// enforces the same permissions server-side (see `requirePermission` in
// auth-helpers), so a user who edits localStorage gains nothing but a menu.

export const LABEL_PRINT_PERMISSION = 'dressing_plant.label.print';

/** Where a label-only operator lives. */
export const LABELS_HOME = '/dashboard/dressing-plant/labels';

export function getPermissions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('permissions');
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function isSuperadmin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw)?.is_superadmin === true : false;
  } catch {
    return false;
  }
}

/**
 * True when this account may print labels and do nothing else — the shape the
 * `label_printer` role produces. Deliberately "only": a supervisor who also
 * holds the label permission keeps the full navigation.
 */
export function isLabelOnlyUser(): boolean {
  if (isSuperadmin()) return false;
  const perms = getPermissions();
  return perms.length > 0 && perms.every((p) => p === LABEL_PRINT_PERMISSION);
}
