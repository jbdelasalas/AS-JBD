import { query } from '@/lib/db';
import { err } from '@/lib/api-response';
import type { AuthContext } from '@/lib/auth-helpers';

export interface PortalCustomer {
  id: string;
  company_id: string;
  code: string;
  name: string;
  customer_type: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  payment_terms_days: number;
  credit_limit: number;
}

/**
 * Resolves the customer linked to the logged-in portal user.
 * Every portal API route MUST call this and scope all queries to the returned
 * customer so one customer can never read or write another's data.
 *
 * Returns either the customer or a Response to return immediately (403).
 */
export async function resolvePortalCustomer(
  auth: AuthContext,
): Promise<{ customer: PortalCustomer } | { response: Response }> {
  const rows = await query<{ customer_id: string | null }>(
    `SELECT customer_id FROM users WHERE id = $1`,
    [auth.userId],
  );
  const customerId = rows[0]?.customer_id;
  if (!customerId) {
    return { response: err('This account is not linked to a customer portal.', 403) };
  }

  const cust = await query<PortalCustomer>(
    `SELECT id, company_id, code, name, customer_type, contact_person,
            email, phone, address, payment_terms_days, credit_limit
       FROM customers WHERE id = $1`,
    [customerId],
  );
  if (!cust[0]) {
    return { response: err('Linked customer not found.', 404) };
  }
  return { customer: { ...cust[0], credit_limit: Number(cust[0].credit_limit) } };
}

// Portal 7-stage workflow. Order matters (index = progress).
export const PORTAL_STAGES = [
  'Pending',
  'Approved',
  'Allocated',
  'Truck Assigned',
  'Ready to Dispatch',
  'Out for Delivery',
  'Delivered',
] as const;

export const PORTAL_TERMINAL = ['Delivered', 'Cancelled', 'Rejected'];

export type PortalStage = (typeof PORTAL_STAGES)[number];
