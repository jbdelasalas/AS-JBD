'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearAuth } from '@/lib/api';

const NAV = [
  { href: '/dashboard',             label: 'Dashboard' },
  { href: '/dashboard/gl',          label: 'General ledger' },
  { href: '/dashboard/ar',          label: 'Receivables' },
  { href: '/dashboard/ap',          label: 'Payables' },
  { href: '/dashboard/sales',       label: 'Sales & CRM' },
  { href: '/dashboard/purchasing',  label: 'Purchasing' },
  { href: '/dashboard/inventory',   label: 'Inventory' },
  { href: '/dashboard/fuel',        label: 'Fuel ops' },
  { href: '/dashboard/reports',     label: 'Reports' },
  { href: '/dashboard/bir',         label: 'BIR compliance' },
  { href: '/dashboard/admin',       label: 'Administration' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    clearAuth();
    router.replace('/login');
  }

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-700">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">ERP System</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">Perpet Pilipinas Corp.</div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-1 block rounded px-3 py-2 text-sm ${
                active
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
  );
}
