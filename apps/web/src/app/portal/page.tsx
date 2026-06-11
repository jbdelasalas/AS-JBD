'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PortalHeader, PortalFooter } from '@/components/portal/PortalHeader';
import { StatusBadge } from '@/components/portal/StatusBadge';
import type { PortalCustomer } from './layout';

type OrderLine = { description: string; quantity: number; unit_price: number; line_total: number; uom: string };
type Order = {
  id: string;
  order_no: string;
  order_date: string;
  delivery_date: string | null;
  reference: string | null;
  total: number;
  priority: string;
  portal_status: string;
  lines: OrderLine[];
};

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

export default function PortalHome() {
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [tab, setTab] = useState<'ongoing' | 'confirmed'>('ongoing');
  const [ongoing, setOngoing] = useState<Order[]>([]);
  const [confirmed, setConfirmed] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem('portal_customer');
    if (raw) setCustomer(JSON.parse(raw));
    Promise.all([
      api.get<{ data: Order[] }>('/portal/orders?scope=ongoing'),
      api.get<{ data: Order[] }>('/portal/orders?scope=confirmed'),
    ])
      .then(([on, conf]) => {
        setOngoing(on.data);
        setConfirmed(conf.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isConfirmed = tab === 'confirmed';
  const list = isConfirmed ? confirmed : ongoing;

  return (
    <>
      <PortalHeader subtitle={isConfirmed ? 'CONFIRMED ORDERS HISTORY' : 'ORDER ONLINE · TRACK REAL-TIME'} />

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Welcome card — only on the ongoing tab, matching the screenshots */}
        {!isConfirmed && customer && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <h2 className="text-lg font-bold text-[#1e2a44]">Welcome, {customer.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Account {customer.code}
              {customer.contact_person ? ` · Contact: ${customer.contact_person}` : ''}
            </p>
          </div>
        )}

        {/* Ongoing / Confirmed toggle */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => setTab('ongoing')}
            className={`rounded-lg px-4 py-3 text-sm font-bold transition ${
              !isConfirmed
                ? 'bg-[#1e2a44] text-white shadow'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Ongoing Orders
          </button>
          <button
            onClick={() => setTab('confirmed')}
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${
              isConfirmed
                ? 'bg-[#1e2a44] text-white shadow'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Confirmed Orders
            <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#c1121f] px-1.5 py-0.5 text-[11px] font-bold text-white">
              {confirmed.length}
            </span>
          </button>
        </div>

        {/* Place a New Order banner (ongoing tab only) */}
        {!isConfirmed && (
          <Link
            href="/portal/orders/new"
            className="mb-6 flex items-center justify-between rounded-xl bg-[#c1121f] px-6 py-4 text-white shadow-sm transition hover:bg-[#a30f1a]"
          >
            <div>
              <div className="flex items-center gap-2 text-base font-bold">📦 Place a New Order</div>
              <p className="text-sm text-white/80">Order at your contracted prices, live GPS tracking</p>
            </div>
            <span className="text-2xl">→</span>
          </Link>
        )}

        {/* Orders list */}
        {!isConfirmed && (
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            Active Orders (Newest First)
          </p>
        )}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-400">
            Loading orders…
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-500">
            {isConfirmed
              ? 'No confirmed or completed orders yet.'
              : 'No ongoing orders. Place a new order above, or check Confirmed Orders for past deliveries.'}
          </div>
        ) : (
          <div className="space-y-3">
            {list.map((o) => (
              <Link
                key={o.id}
                href={`/portal/orders/${o.id}`}
                className="block rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#1e2a44]">{o.order_no}</span>
                      <StatusBadge status={o.portal_status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Ordered {o.order_date}
                      {o.delivery_date ? ` · Delivery ${o.delivery_date}` : ''}
                      {o.reference ? ` · PO ${o.reference}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-[#1e2a44]">{peso(o.total)}</div>
                    <div className="text-xs text-slate-400">
                      {o.lines.length} item{o.lines.length === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <PortalFooter />
    </>
  );
}
