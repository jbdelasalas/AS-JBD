'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatPHP } from '@/lib/format';

interface MonthlySale { month: string; total: number; count: number; }
interface Aging {
  current_amount: number; days_31_60: number; days_61_90: number;
  days_91_120: number; over_120: number; total: number;
}
interface PendingInvoice {
  id: string; invoice_no: string; invoice_date: string;
  total: number; customer_name: string; status: string;
}
interface PendingBill {
  id: string; internal_no: string; bill_date: string;
  total: number; supplier_name: string; status: string;
}
interface DashboardData {
  monthly_sales: MonthlySale[];
  ar_aging: Aging;
  ap_aging: Aging;
  pending_invoices: PendingInvoice[];
  pending_bills: PendingBill[];
}

const MONTH_LABELS: Record<string, string> = {
  '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec',
};

function monthLabel(ym: string) {
  const [, m] = ym.split('-');
  return MONTH_LABELS[m] ?? m;
}

function SalesChart({ data }: { data: MonthlySale[] }) {
  const PL = 56, PR = 8, PT = 8, PB = 28;
  const W = 540, H = 140;
  const totalW = PL + W + PR;
  const totalH = PT + H + PB;
  const max = Math.max(...data.map((d) => d.total), 1);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const n = data.length || 1;
  const groupW = W / n;
  const barW = Math.max(groupW * 0.55, 8);

  function fmt(v: number) {
    if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `₱${(v / 1_000).toFixed(0)}K`;
    return `₱${v.toFixed(0)}`;
  }

  return (
    <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full" style={{ height: 200 }}>
      {yTicks.map((pct) => {
        const y = PT + H * (1 - pct);
        return (
          <g key={pct}>
            <line x1={PL} y1={y} x2={PL + W} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PL - 4} y={y + 3.5} textAnchor="end" fontSize={9} fill="#94a3b8">
              {fmt(max * pct)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const barH = Math.max((d.total / max) * H, d.total > 0 ? 2 : 0);
        const x = PL + i * groupW + (groupW - barW) / 2;
        const y = PT + H - barH;
        return (
          <g key={d.month}>
            <rect x={x} y={y} width={barW} height={barH} rx={2} fill="#2563eb" opacity={0.85} />
            <text x={x + barW / 2} y={PT + H + 16} textAnchor="middle" fontSize={9} fill="#64748b">
              {monthLabel(d.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const AGING_BUCKETS = [
  { key: 'current_amount', label: 'Current (0–30d)',  color: 'bg-emerald-500' },
  { key: 'days_31_60',    label: '31–60 days',        color: 'bg-yellow-400' },
  { key: 'days_61_90',    label: '61–90 days',        color: 'bg-orange-400' },
  { key: 'days_91_120',   label: '91–120 days',       color: 'bg-red-500'    },
  { key: 'over_120',      label: '120+ days',         color: 'bg-red-800'    },
] as const;

function AgingWidget({ title, data, href }: { title: string; data: Aging; href: string }) {
  const total = data.total || 1;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <Link href={href} className="text-xs text-brand-600 hover:underline dark:text-brand-400">View all</Link>
      </div>
      <div className="mb-3 text-xl font-bold text-slate-900 dark:text-slate-100">{formatPHP(data.total)}</div>

      <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        {AGING_BUCKETS.map(({ key, color }) => {
          const pct = (data[key] / total) * 100;
          return pct > 0 ? (
            <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} title={`${pct.toFixed(1)}%`} />
          ) : null;
        })}
      </div>

      <div className="space-y-1">
        {AGING_BUCKETS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className={`h-2 w-2 rounded-full ${color}`} />
              <span className="text-slate-600 dark:text-slate-400">{label}</span>
            </div>
            <span className="font-mono text-slate-700 dark:text-slate-300">{formatPHP(data[key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  pending_approval: 'bg-amber-100 text-amber-700',
};

export default function DashboardHome() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    if (!companyId) { setLoading(false); return; }
    api.get<DashboardData>(`/dashboard?company_id=${companyId}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pendingCount = (data?.pending_invoices.length ?? 0) + (data?.pending_bills.length ?? 0);

  return (
    <div className="space-y-5">
      {/* Sales Chart */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sales — last 6 months</span>
          <Link href="/dashboard/ar/invoices" className="text-xs text-brand-600 hover:underline dark:text-brand-400">View invoices</Link>
        </div>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center text-xs text-slate-400">Loading…</div>
        ) : !data?.monthly_sales.length ? (
          <div className="flex h-[200px] items-center justify-center text-xs text-slate-400">No sales data yet</div>
        ) : (
          <SalesChart data={data.monthly_sales} />
        )}
      </div>

      {/* AR and AP Aging */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading ? (
          <>
            <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          </>
        ) : (
          <>
            <AgingWidget
              title="AR Aging"
              data={data?.ar_aging ?? { current_amount: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, total: 0 }}
              href="/dashboard/ar"
            />
            <AgingWidget
              title="AP Aging"
              data={data?.ap_aging ?? { current_amount: 0, days_31_60: 0, days_61_90: 0, days_91_120: 0, over_120: 0, total: 0 }}
              href="/dashboard/ap"
            />
          </>
        )}
      </div>

      {/* For Approval */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">For Approval</span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {pendingCount}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-slate-400">Loading…</div>
        ) : pendingCount === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">No items pending approval</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">Reference</th>
                <th className="px-4 py-2 text-left font-medium">Party</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.pending_invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">Invoice</td>
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/ar/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {inv.invoice_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{inv.customer_name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{inv.invoice_date}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-300">{formatPHP(inv.total)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[inv.status] ?? STATUS_COLORS.draft}`}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {data?.pending_bills.map((bill) => (
                <tr key={bill.id} className="border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">Bill</td>
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/ap/bills/${bill.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {bill.internal_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{bill.supplier_name}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{bill.bill_date}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-300">{formatPHP(bill.total)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_COLORS[bill.status] ?? STATUS_COLORS.pending_approval}`}>
                      {bill.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
