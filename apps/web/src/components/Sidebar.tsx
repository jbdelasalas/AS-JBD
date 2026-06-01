'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearAuth } from '@/lib/api';

interface NavItem {
  href: string;
  label: string;
  children?: { href: string; label: string }[];
}

const NAV: NavItem[] = [
  { href: '/dashboard',            label: 'Dashboard' },
  { href: '/dashboard/gl',         label: 'General ledger' },
  { href: '/dashboard/ar',         label: 'Receivables' },
  { href: '/dashboard/ap',         label: 'Payables' },
  { href: '/dashboard/sales',      label: 'Sales & CRM' },
  { href: '/dashboard/purchasing', label: 'Purchasing' },
  { href: '/dashboard/inventory',  label: 'Inventory' },
  {
    href: '/dashboard/poultry',
    label: 'Poultry Operations',
    children: [
      { href: '/dashboard/purchasing/purchase-orders', label: 'Purchase Orders' },
      { href: '/dashboard/purchasing/goods-receipts',  label: 'Goods Receipts' },
      { href: '/dashboard/poultry/grow-cycles',        label: 'Grow Cycles' },
      { href: '/dashboard/poultry/tally-sheets',       label: 'Tally Sheets' },
      { href: '/dashboard/poultry/conversions',        label: 'Conversions' },
      { href: '/dashboard/poultry/sales-tallies',      label: 'Sales Tallies' },
      { href: '/dashboard/poultry/deliveries',         label: 'Deliveries' },
      { href: '/dashboard/poultry/invoices',           label: 'Invoices' },
    ],
  },
  { href: '/dashboard/reports',    label: 'Reports' },
  { href: '/dashboard/bir',        label: 'BIR compliance' },
  { href: '/dashboard/admin',      label: 'Administration' },
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

  useEffect(() => {
    const name = localStorage.getItem('company_name');
    if (name) setCompanyName(name);
  }, []);

  // Auto-expand the group that contains the current page
  useEffect(() => {
    for (const item of NAV) {
      if (item.children?.some((c) => pathname.startsWith(c.href))) {
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
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 dark:border-slate-700">
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

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const isExpanded = expanded === item.href;

            if (item.children) {
              return (
                <div key={item.href}>
                  {/* Group toggle button */}
                  <button
                    onClick={() => toggleGroup(item.href)}
                    className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                      isActive
                        ? 'bg-brand-50 text-brand-700 font-medium dark:bg-slate-800 dark:text-brand-400'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{item.label}</span>
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
