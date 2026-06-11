'use client';
import Link from 'next/link';

const MASTER_DATA = [
  {
    group: 'Inventory',
    items: [
      { href: '/dashboard/admin/master-data/items', title: 'Items', desc: 'SKUs, pricing, costing, and item catalog', icon: '📦' },
    ],
  },
  {
    group: 'Farm & Operations',
    items: [
      { href: '/dashboard/admin/master-data/buildings', title: 'Buildings', desc: 'Farm buildings and houses', icon: '🏠' },
      { href: '/dashboard/admin/master-data/grow-references', title: 'Grow References', desc: 'Grow cycle reference names (Grow 1, Grow 2…)', icon: '🌱' },
      { href: '/dashboard/admin/master-data/delivery-methods', title: 'Delivery Methods', desc: 'IN HOUSE, PICK UP, THIRD PARTY, and more', icon: '🚚' },
    ],
  },
  {
    group: 'Parties',
    items: [
      { href: '/dashboard/admin/master-data/customers', title: 'Customers', desc: 'Customer accounts, credit limits, and payment terms', icon: '👥' },
      { href: '/dashboard/admin/master-data/price-list', title: 'Contracted Prices', desc: 'Per-customer pricing for the customer portal', icon: '🏷️' },
      { href: '/dashboard/admin/master-data/suppliers', title: 'Suppliers', desc: 'Supplier accounts, TIN, payment terms, and EWT rates', icon: '🏭' },
    ],
  },
  {
    group: 'Organization',
    items: [
      { href: '/dashboard/admin/master-data/locations', title: 'Locations / Branches', desc: 'Farm sites, branches, and offices', icon: '📍' },
      { href: '/dashboard/admin/cost-centers', title: 'Cost Centers', desc: 'Departments and cost allocation centers', icon: '📊' },
      { href: '/dashboard/admin/master-data/departments', title: 'Departments', desc: 'Company departments and business units', icon: '🏢' },
    ],
  },
];

export default function MasterDataPage() {
  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Master Data</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage all reference data used across modules.</p>
        </div>
        <Link href="/dashboard/admin" className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          ← Administration
        </Link>
      </div>

      <div className="space-y-6">
        {MASTER_DATA.map(group => (
          <div key={group.group}>
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{group.group}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.items.map(item => (
                <Link key={item.href} href={item.href}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 hover:border-brand-300 dark:hover:border-brand-600 hover:shadow-sm transition-all">
                  <span className="text-2xl leading-none mt-0.5">{item.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{item.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
