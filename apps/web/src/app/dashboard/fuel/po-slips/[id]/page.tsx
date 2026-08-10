'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Slip {
  id: string;
  slip_no: string;
  entity_code: string;
  issue_date: string;
  issued_to_name: string;
  position_dept: string | null;
  plate_no: string | null;
  product: string;
  quantity_litres: number | null;
  purpose: string | null;
  notes: string | null;
  status: string;
  station_name: string | null;
  gas_up_at: string | null;
  odometer_km: number | null;
  actual_litres: number | null;
  official_receipt_no: string | null;
  catered_by: string | null;
  amount: number | null;
  unit_price: number | null;
  km_travelled: number | null;
  km_per_litre: number | null;
  employee_name: string | null;
  employee_no: string | null;
  vehicle_description: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  redeemed_by_name: string | null;
  redeemed_at: string | null;
  created_by_name: string | null;
  cancel_reason: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  issued:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  redeemed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelCls = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';

function fmt(n: number | null, dec = 2): string {
  if (n == null) return '—';
  return n.toLocaleString('en-PH', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right text-xs font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

export default function FuelPOSlipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [slip, setSlip] = useState<Slip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redeem form
  const [showRedeem, setShowRedeem] = useState(false);
  const [station, setStation] = useState('');
  const [gasUpAt, setGasUpAt] = useState('');
  const [odometer, setOdometer] = useState('');
  const [actualLitres, setActualLitres] = useState('');
  const [orNo, setOrNo] = useState('');
  const [cateredBy, setCateredBy] = useState('');
  const [amount, setAmount] = useState('');
  const [allowOver, setAllowOver] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Slip>(`/fuel/po-slips/${id}`)
      .then(setSlip)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doRedeem() {
    if (!actualLitres || Number(actualLitres) <= 0) { setError('Actual litres is required'); return; }
    if (amount === '' || Number(amount) < 0) { setError('Amount is required'); return; }
    await act(async () => {
      await api.post(`/fuel/po-slips/${id}/redeem`, {
        station_name: station.trim() || null,
        gas_up_at: gasUpAt ? new Date(gasUpAt).toISOString() : null,
        odometer_km: odometer === '' ? null : Number(odometer),
        actual_litres: Number(actualLitres),
        official_receipt_no: orNo.trim() || null,
        catered_by: cateredBy.trim() || null,
        amount: Number(amount),
        allow_over_limit: allowOver,
      });
      setShowRedeem(false);
    });
  }

  async function doCancel() {
    const reason = window.prompt('Reason for cancelling this slip?');
    if (!reason?.trim()) return;
    await act(() => api.post(`/fuel/po-slips/${id}/cancel`, { reason: reason.trim() }));
  }

  async function doDelete() {
    if (!window.confirm('Delete this draft slip? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.delete(`/fuel/po-slips/${id}`);
      router.push('/dashboard/fuel/po-slips');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>;
  }
  if (!slip) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        {error ?? 'Slip not found.'}
      </div>
    );
  }

  const overLimit =
    slip.quantity_litres != null && actualLitres !== '' && Number(actualLitres) > slip.quantity_litres;
  const variance =
    slip.quantity_litres != null && slip.actual_litres != null
      ? slip.actual_litres - slip.quantity_litres
      : null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/fuel/po-slips" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
            ← Back to slips
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
            <span className="font-mono">P.O. Slip No. {slip.slip_no}</span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[slip.status]}`}>
              {slip.status}
            </span>
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {slip.entity_code} · issued {fmtDate(slip.issue_date)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`/print/fuel-po-slip/${slip.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Print Slip
          </a>
          {slip.status === 'draft' && (
            <>
              <button
                onClick={() => act(() => api.post(`/fuel/po-slips/${id}/issue`))}
                disabled={busy}
                className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Approve &amp; Issue
              </button>
              <button
                onClick={doDelete}
                disabled={busy}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
          {slip.status === 'issued' && (
            <>
              <button
                onClick={() => setShowRedeem((v) => !v)}
                disabled={busy}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {showRedeem ? 'Close' : 'Capture Station Data'}
              </button>
              <button
                onClick={doCancel}
                disabled={busy}
                className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Cancel Slip
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {slip.status === 'cancelled' && slip.cancel_reason && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <strong>Cancelled:</strong> {slip.cancel_reason}
        </div>
      )}

      {/* ── Redeem form ── */}
      {showRedeem && slip.status === 'issued' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-800 dark:bg-emerald-900/10">
          <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Portion accomplished by station
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Copy these off the returned chit and the official receipt.
          </p>
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 sm:col-span-6">
              <label className={labelCls}>Company / Station</label>
              <input value={station} onChange={(e) => setStation(e.target.value)} placeholder="Shell — Sto. Tomas" className={inputCls} />
            </div>
            <div className="col-span-12 sm:col-span-6">
              <label className={labelCls}>Date / Time of gas-up</label>
              <input type="datetime-local" value={gasUpAt} onChange={(e) => setGasUpAt(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className={labelCls}>Milage / KM reading</label>
              <input type="number" min="0" step="1" value={odometer} onChange={(e) => setOdometer(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className={labelCls}>Actual gas-up litres *</label>
              <input type="number" min="0" step="0.01" value={actualLitres} onChange={(e) => setActualLitres(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className={labelCls}>Amount in Php. *</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className={labelCls}>Official Receipt #</label>
              <input value={orNo} onChange={(e) => setOrNo(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-12 sm:col-span-6">
              <label className={labelCls}>Catered by (forecourt team member)</label>
              <input value={cateredBy} onChange={(e) => setCateredBy(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-12 sm:col-span-6 flex items-end">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {actualLitres && amount
                  ? <>Unit price: <strong>₱{fmt(Number(amount) / Number(actualLitres), 4)}</strong> / L</>
                  : 'Unit price is computed from amount ÷ litres.'}
              </div>
            </div>
          </div>

          {overLimit && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={allowOver} onChange={(e) => setAllowOver(e.target.checked)} className="mt-0.5" />
                <span>
                  Actual {actualLitres} L exceeds the {fmt(slip.quantity_litres, 0)} L authorised on this slip.
                  Tick to accept the variance on record.
                </span>
              </label>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={doRedeem}
              disabled={busy || (overLimit && !allowOver)}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save Station Data'}
            </button>
            <button
              onClick={() => setShowRedeem(false)}
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Detail panels ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Issued to</h2>
          <Row label="Name" value={slip.issued_to_name} />
          <Row label="Employee no." value={slip.employee_no ?? '—'} />
          <Row label="Position / Dept." value={slip.position_dept ?? '—'} />
          <Row label="Vehicle / Plate no." value={<span className="font-mono">{slip.plate_no ?? '—'}</span>} />
          <Row label="Vehicle" value={slip.vehicle_description ?? '—'} />
          <Row label="Product" value={<span className="capitalize">{slip.product}</span>} />
          <Row label="Authorised litres" value={slip.quantity_litres != null ? `${fmt(slip.quantity_litres, 0)} L` : '—'} />
          <Row label="Purpose" value={slip.purpose ?? '—'} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Accomplished by station</h2>
          {slip.status !== 'redeemed' ? (
            <p className="py-6 text-center text-xs text-slate-400">
              Not yet redeemed — the slip is still with the driver.
            </p>
          ) : (
            <>
              <Row label="Station" value={slip.station_name ?? '—'} />
              <Row label="Gas-up" value={slip.gas_up_at ? new Date(slip.gas_up_at).toLocaleString('en-PH') : '—'} />
              <Row label="Odometer" value={slip.odometer_km != null ? `${fmt(slip.odometer_km, 0)} km` : '—'} />
              <Row label="Actual litres" value={`${fmt(slip.actual_litres)} L`} />
              <Row label="Amount" value={`₱${fmt(slip.amount)}`} />
              <Row label="Unit price" value={slip.unit_price != null ? `₱${fmt(slip.unit_price, 4)} / L` : '—'} />
              <Row label="Official Receipt #" value={slip.official_receipt_no ?? '—'} />
              <Row label="Catered by" value={slip.catered_by ?? '—'} />
            </>
          )}
        </div>

        {slip.status === 'redeemed' && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Consumption</h2>
            <Row label="Distance since last slip" value={slip.km_travelled != null ? `${fmt(slip.km_travelled, 1)} km` : '— (no prior reading)'} />
            <Row label="Fuel economy" value={slip.km_per_litre != null ? `${fmt(slip.km_per_litre, 2)} km/L` : '—'} />
            <Row
              label="Cost per km"
              value={
                slip.km_travelled && slip.amount && slip.km_travelled > 0
                  ? `₱${fmt(slip.amount / slip.km_travelled, 2)}`
                  : '—'
              }
            />
            <Row
              label="Variance vs authorised"
              value={
                variance == null ? '—' : (
                  <span className={variance > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                    {variance > 0 ? '+' : ''}{fmt(variance)} L
                  </span>
                )
              }
            />
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Audit trail</h2>
          <Row label="Created by" value={slip.created_by_name ?? '—'} />
          <Row label="Approved by" value={slip.approved_by_name ?? '—'} />
          <Row label="Approved at" value={slip.approved_at ? new Date(slip.approved_at).toLocaleString('en-PH') : '—'} />
          <Row label="Redeemed by" value={slip.redeemed_by_name ?? '—'} />
          <Row label="Redeemed at" value={slip.redeemed_at ? new Date(slip.redeemed_at).toLocaleString('en-PH') : '—'} />
          {slip.notes && <Row label="Notes" value={slip.notes} />}
        </div>
      </div>
    </div>
  );
}
