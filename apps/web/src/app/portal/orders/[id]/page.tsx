'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { PortalHeader, PortalFooter } from '@/components/portal/PortalHeader';
import { StatusBadge } from '@/components/portal/StatusBadge';

type Line = { line_no: number; description: string; quantity: number; unit_price: number; line_total: number; uom: string };
type Stage = { stage: string; at: string | null; done: boolean; current: boolean };
type Detail = {
  order: {
    order_no: string;
    order_date: string;
    delivery_date: string | null;
    reference: string | null;
    subtotal: number;
    total: number;
    priority: string;
    portal_status: string;
    notes: string | null;
    truck_no: string | null;
    driver: string | null;
    dr_number: string | null;
    gps_url: string | null;
  };
  lines: Line[];
  timeline: Stage[];
};

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);

const fmt = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function PortalOrderTracking() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Detail>(`/portal/orders/${id}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  return (
    <>
      <PortalHeader subtitle="ORDER TRACKING" backHref="/portal" backLabel="Back to Orders" />

      <main className="mx-auto max-w-3xl px-6 py-6">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        {!data && !error && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-400">
            Loading…
          </div>
        )}

        {data && (
          <>
            <div className="mb-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-[#1e2a44]">{data.order.order_no}</h2>
                    <StatusBadge status={data.order.portal_status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Ordered {data.order.order_date}
                    {data.order.delivery_date ? ` · Delivery ${data.order.delivery_date}` : ''}
                    {data.order.reference ? ` · PO ${data.order.reference}` : ''}
                  </p>
                </div>
                <div className="text-right text-xl font-bold text-[#1e2a44]">{peso(data.order.total)}</div>
              </div>

              {(data.order.truck_no || data.order.driver || data.order.dr_number) && (
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 sm:grid-cols-3">
                  {data.order.truck_no && <div><span className="text-slate-400">Truck</span><br />{data.order.truck_no}</div>}
                  {data.order.driver && <div><span className="text-slate-400">Driver</span><br />{data.order.driver}</div>}
                  {data.order.dr_number && <div><span className="text-slate-400">DR No.</span><br />{data.order.dr_number}</div>}
                  {data.order.gps_url && (
                    <div className="col-span-2 sm:col-span-3">
                      <a href={data.order.gps_url} target="_blank" rel="noreferrer" className="text-[#c1121f] hover:underline">
                        📍 Track live GPS location
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 7-stage timeline */}
            <div className="mb-4 rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
              <p className="mb-4 text-xs font-bold uppercase tracking-wide text-slate-400">Order Progress</p>
              <ol className="relative ml-3 border-l-2 border-slate-200">
                {data.timeline.map((s) => (
                  <li key={s.stage} className="mb-5 ml-5 last:mb-0">
                    <span
                      className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ${
                        s.current ? 'bg-[#c1121f] ring-4 ring-red-100' : s.done ? 'bg-green-500' : 'bg-slate-300'
                      }`}
                    />
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${s.done ? 'text-slate-800' : 'text-slate-400'}`}>
                        {s.stage}
                      </span>
                      {s.at && <span className="text-xs text-slate-400">{fmt(s.at)}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Line items */}
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Items</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Unit Price</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.line_no} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{l.description}</td>
                      <td className="py-2 text-right text-slate-700">{l.quantity} {l.uom}</td>
                      <td className="py-2 text-right text-slate-700">{peso(l.unit_price)}</td>
                      <td className="py-2 text-right font-medium text-slate-800">{peso(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <td colSpan={3} className="pt-3 text-right font-semibold text-slate-600">Total</td>
                    <td className="pt-3 text-right text-base font-bold text-[#1e2a44]">{peso(data.order.total)}</td>
                  </tr>
                </tfoot>
              </table>
              {data.order.notes && (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span className="font-semibold">Notes:</span> {data.order.notes}
                </p>
              )}
            </div>
          </>
        )}
      </main>

      <PortalFooter />
    </>
  );
}
