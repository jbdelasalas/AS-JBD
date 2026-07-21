'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, clearAuth } from '@/lib/api';

interface NavItem {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
  // Optional feature-flag name gating this group.
  flag?: string;
  // How the flag gates the group:
  //   'off' (default) — hidden until the flag is turned ON  (opt-in, e.g. WMS).
  //   'on'            — shown unless the flag is turned OFF (the module ships
  //                     visible; a superadmin disables it for deployments that
  //                     don't use it, e.g. Poultry / Restaurant / Fuel).
  flagDefault?: 'on' | 'off';
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  {
    href: '/dashboard/gl',
    label: 'General Ledger',
    children: [
      { href: '/dashboard/gl/accounts',       label: 'Chart of Accounts' },
      { href: '/dashboard/gl/journal-entries', label: 'Journal Entries' },
      { href: '/dashboard/gl/trial-balance',  label: 'Trial Balance' },
      { href: '/dashboard/gl/bank-reconciliation', label: 'Bank Reconciliation' },
    ],
  },
  {
    href: '/dashboard/ar',
    label: 'Receivables',
    children: [
      { href: '/dashboard/ar/customers',    label: 'Customers' },
      { href: '/dashboard/ar/invoices',     label: 'Invoices' },
      { href: '/dashboard/ar/collections',  label: 'Collections' },
      { href: '/dashboard/ar/credit-memos', label: 'Credit Memos' },
    ],
  },
  {
    href: '/dashboard/ap',
    label: 'Payables',
    children: [
      { href: '/dashboard/ap/bills',           label: 'Bills' },
      { href: '/dashboard/ap/credit-memos',     label: 'Credit Memos' },
      { href: '/dashboard/ap/payments',         label: 'Payments' },
      { href: '/dashboard/ap/expense-reports',  label: 'Expense Reports' },
    ],
  },
  {
    href: '/dashboard/sales',
    label: 'Sales & CRM',
    children: [
      { href: '/dashboard/sales/orders',             label: 'Sales Orders' },
      { href: '/dashboard/sales/delivery-receipts',  label: 'Delivery Receipts' },
      { href: '/dashboard/sales/return-goods',       label: 'Return Goods' },
      { href: '/dashboard/sales/allocations',        label: 'Order Allocations' },
      { href: '/portal',                             label: 'Customer Portal ↗' },
    ],
  },
  {
    href: '/dashboard/purchasing',
    label: 'Purchasing',
    children: [
      { href: '/dashboard/purchasing/suppliers',       label: 'Suppliers' },
      { href: '/dashboard/purchasing/purchase-orders', label: 'Purchase Orders' },
      { href: '/dashboard/purchasing/goods-receipts',  label: 'Goods Receipts' },
    ],
  },
  {
    href: '/dashboard/inventory',
    label: 'Inventory',
    children: [
      { href: '/dashboard/inventory/items',        label: 'Items' },
      { href: '/dashboard/inventory/stock-on-hand', label: 'Stock on Hand' },
      { href: '/dashboard/inventory/adjustments',  label: 'Adjustments' },
      { href: '/dashboard/inventory/transfers',    label: 'Transfers' },
      { href: '/dashboard/inventory/counts',       label: 'Counts' },
    ],
  },
  {
    href: '/dashboard/wms',
    label: 'Warehouse',
    flag: 'wms',
    children: [
      { href: '/dashboard/wms/bins',         label: 'Bins' },
      { href: '/dashboard/wms/stock-on-hand', label: 'Bin Stock' },
      { href: '/dashboard/wms/putaways',     label: 'Put-away' },
      { href: '/dashboard/wms/pick-lists',   label: 'Pick Lists' },
      { href: '/dashboard/wms/shipments',    label: 'Shipments' },
      { href: '/dashboard/wms/lots',         label: 'Lots & Serials' },
    ],
  },
  {
    href: '/dashboard/fuel',
    label: 'Fuel',
    flag: 'fuel',
    flagDefault: 'on',
    children: [
      { href: '/dashboard/fuel/tanks',      label: 'Tanks' },
      { href: '/dashboard/fuel/deliveries', label: 'Deliveries' },
    ],
  },
  {
    href: '/dashboard/dressing-plant',
    label: 'Dressing Plant',
    flag: 'dressing_plant',
    children: [
      { href: '/dashboard/dressing-plant/job-orders',   label: 'Job Orders' },
      { href: '/dashboard/dressing-plant/receiving',    label: 'Receiving' },
      { href: '/dashboard/dressing-plant/yield',        label: 'Yield & WIP' },
      { href: '/dashboard/dressing-plant/marination',   label: 'Marination' },
      { href: '/dashboard/dressing-plant/cold-chain',   label: 'Cold Chain' },
      { href: '/dashboard/dressing-plant/invoices',     label: 'Invoices' },
      { href: '/dashboard/dressing-plant/dispatch',     label: 'Dispatch & Gate' },
      { href: '/dashboard/dressing-plant/maintenance',  label: 'Sanitation & PM' },
    ],
  },
  {
    href: '/dashboard/poultry',
    label: 'Poultry Operations',
    flag: 'poultry',
    flagDefault: 'on',
    children: [
      { href: '/dashboard/poultry/grow-cycles',   label: 'Grow Cycles' },
      { href: '/dashboard/poultry/tally-sheets',  label: 'Tally Sheets' },
      { href: '/dashboard/poultry/conversions',   label: 'Conversions' },
      { href: '/dashboard/poultry/sales-tallies', label: 'Sales Tallies' },
    ],
  },
  {
    href: '/dashboard/restaurant',
    label: 'Restaurant',
    flag: 'restaurant',
    flagDefault: 'on',
    children: [
      { href: '/dashboard/purchasing/purchase-orders', label: 'Purchase Orders' },
      { href: '/dashboard/ap/bills',                    label: 'Bills' },
      { href: '/dashboard/ar/invoices',                 label: 'Sales Invoice' },
    ],
  },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/bir',     label: 'BIR Compliance' },
  { href: '/dashboard/ai',      label: 'AI Analysis' },
  { href: '/dashboard/admin', label: 'Administration' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isSandbox, setIsSandbox] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Resolved enabled-state of every flag the nav references. Until a flag's real
  // value arrives it is `undefined` — opt-in groups (flagDefault 'off') stay
  // hidden so they never flash, while default-on groups stay visible and only
  // hide once a confirmed `false` arrives.
  const [flagStates, setFlagStates] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    const name = localStorage.getItem('company_name');
    if (name) setCompanyName(name);
    const mode = localStorage.getItem('db-mode');
    setIsSandbox(mode === 'sandbox');

    // Resolve every flag the nav references, in parallel.
    const flagNames = [...new Set(NAV.map((n) => n.flag).filter((f): f is string => !!f))];
    Promise.all(
      flagNames.map(async (f) => {
        try {
          const res = await api.get<{ data: { enabled: boolean } }>(`/flags?name=${encodeURIComponent(f)}`);
          return [f, res.data.enabled] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      setFlagStates(new Map(pairs.filter((p): p is readonly [string, boolean] => !!p)));
    });
  }, []);

  const navItems = NAV.filter((item) => {
    if (!item.flag) return true;
    const state = flagStates.get(item.flag);
    // Default-on modules show unless a confirmed OFF arrives; default-off (opt-in)
    // modules show only once a confirmed ON arrives.
    return item.flagDefault === 'on' ? state !== false : state === true;
  });

  async function confirmSwitch() {
    setShowConfirm(false);
    setSwitching(true);
    const next = isSandbox ? 'production' : 'sandbox';
    await fetch('/api/v1/set-db-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    });
    localStorage.setItem('db-mode', next);
    window.location.reload();
  }

  // Auto-expand the group whose parent or children match the current page
  useEffect(() => {
    for (const item of navItems) {
      if (!item.children) continue;
      const parentMatch = pathname === item.href || pathname.startsWith(item.href + '/');
      const childMatch = item.children.some((c) => pathname.startsWith(c.href));
      if (parentMatch || childMatch) {
        setExpanded(item.href);
        break;
      }
    }
  }, [pathname]);

  function handleLogout() {
    clearAuth();
    router.replace('/login');
  }

  function toggleGroup(href: string) {
    setExpanded((prev) => (prev === href ? null : href));
  }

  return (
    <>
      {/* Environment switch confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl dark:bg-slate-800">
            <div className={`rounded-t-xl px-5 py-4 ${isSandbox ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-amber-50 dark:bg-amber-900/30'}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${isSandbox ? 'bg-emerald-100 dark:bg-emerald-800' : 'bg-amber-100 dark:bg-amber-800'}`}>
                  {isSandbox ? '✓' : '⚠'}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${isSandbox ? 'text-emerald-800 dark:text-emerald-200' : 'text-amber-800 dark:text-amber-200'}`}>
                    Switch to {isSandbox ? 'Production' : 'Sandbox'}?
                  </p>
                  <p className={`text-xs ${isSandbox ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                    Currently on <strong>{isSandbox ? 'SANDBOX' : 'PRODUCTION'}</strong>
                  </p>
                </div>
              </div>
            </div>
            <div className="px-5 py-4">
              {isSandbox ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  You are switching to <strong>Production</strong>. Any changes you make will affect <strong>live data</strong>.
                </p>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  You are switching to <strong>Sandbox</strong>. This is a safe test environment — changes here <strong>will not affect production</strong>.
                </p>
              )}
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-700">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmSwitch}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
                  isSandbox
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                Switch to {isSandbox ? 'Production' : 'Sandbox'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backdrop — mobile only */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 flex h-full w-56 flex-col
          border-r border-slate-200 bg-white
          dark:border-slate-700 dark:bg-slate-900
          transition-transform duration-200 ease-in-out
          md:static md:z-auto md:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full'}
          ${!open ? 'md:hidden' : ''}
        `}
      >
        {/* Header */}
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">ERP System</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{companyName}</div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close menu"
              className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 md:hidden"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Environment toggle */}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={switching}
            title={isSandbox ? 'Switch to Production' : 'Switch to Sandbox'}
            className={`mt-2 flex w-full items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
              isSandbox
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400'
            } ${switching ? 'opacity-50 cursor-wait' : ''}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${isSandbox ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {isSandbox ? 'SANDBOX' : 'PRODUCTION'}
            <span className="ml-auto opacity-60">{switching ? '...' : 'switch'}</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const isExpanded = expanded === item.href;

            if (item.children) {
              return (
                <div key={item.href}>
                  {/* Label navigates; chevron toggles sub-list */}
                  <div
                    className={`mb-1 flex items-center rounded text-sm ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 font-medium dark:bg-slate-800 dark:text-brand-400'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Link href={item.href} className="flex-1 px-3 py-2">
                      {item.label}
                    </Link>
                    <button
                      onClick={() => toggleGroup(item.href)}
                      aria-label="Toggle sub-menu"
                      className="flex h-8 w-8 shrink-0 items-center justify-center"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Children */}
                  {isExpanded && (
                    <div className="mb-1 ml-3 border-l border-slate-200 pl-2 dark:border-slate-700">
                      {item.children.map((child) => {
                        const childActive = pathname.startsWith(child.href);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`mb-0.5 block rounded px-3 py-1.5 text-xs ${
                              childActive
                                ? 'bg-brand-50 text-brand-700 font-medium dark:bg-slate-800 dark:text-brand-400'
                                : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'
                            }`}
                          >
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mb-1 block rounded px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 font-medium dark:bg-slate-800 dark:text-brand-400'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-700">
          <button
            onClick={handleLogout}
            className="w-full rounded px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
