'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Counts { suppliers: number; purchaseOrders: number; goodsReceipts: number; }

export default function PurchasingHomePage() {
  const [counts, setCounts] = useState<Counts>({ suppliers: 0, purchaseOrders: 0, goodsReceipts: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    Promise.all([
      api.get<{ total: number }>(`/ap/suppliers?company_id=${companyId}&limit=1`),
      api.get<{ total: number }>(`/purchasing/purchase-orders?company_id=${companyId}&limit=1`),
      api.get<{ total: number }>(`/purchasing/goods-receipts?company_id=${companyId}&limit=1`),
    ]).then(([s, po, gr]) => {
      setCounts({ suppliers: s.total, purchaseOrders: po.total, goodsReceipts: gr.total });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const cards = [
    {
      title: 'Suppliers',
      description: 'Manage vendor master records, contact details, and payment terms.',
      count: counts.suppliers,
      href: '/dashboard/purchasing/suppliers',
      newHref: '/dashboard/purchasing/suppliers/new',
      color: 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950',
      countColor: 'text-brand-700 dark:text-brand-300',
    },
    {
      title: 'Purchase Orders',
      description: 'Create and track POs through draft, approval, and receipt.',
      count: counts.purchaseOrders,
      href: '/dashboard/purchasing/purchase-orders',
      newHref: '/dashboard/purchasing/purchase-orders/new',
      color: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
      countColor: 'text-amber-700 dark:text-amber-300',
    },
    {
      title: 'Goods Receipts',
      description: 'Record goods received against approved purchase orders.',
      count: counts.goodsReceipts,
      href: '/dashboard/purchasing/goods-receipts',
      newHref: '/dashboard/purchasing/goods-receipts/new',
      color: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
      countColor: 'text-emerald-700 dark:text-emerald-300',
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Purchasing</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Purchase orders, goods receipts, and supplier management.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.title} className={`rounded-lg border p-5 ${card.color}`}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">{card.title}</div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{card.description}</p>
              </div>
              {!loading && (
                <div className={`text-2xl font-bold ${card.countColor}`}>{card.count}</div>
              )}
            </div>
            <div className="flex gap-2">
              <Link href={card.href}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                View all
              </Link>
              <Link href={card.newHref}
                className="rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
                + New
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
