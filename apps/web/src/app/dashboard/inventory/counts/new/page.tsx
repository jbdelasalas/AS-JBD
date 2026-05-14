'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Warehouse { id: string; name: string; }

const COUNT_TYPES = ['FULL', 'CYCLE', 'SPOT'] as const;

export default function NewCountPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [countType, setCountType] = useState<string>('FULL');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const companyId = localStorage.getItem('company_id');
    const token = localStorage.getItem('token') ?? '';
    if (!companyId) return;
    fetch(`/api/v1/inventory/stock-on-hand?company_id=${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()).then((res) => {
      const data: Array<{ warehouse_id: string; warehouse_name: string }> =
        Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      const seen = new Set<string>();
      const whs: Warehouse[] = [];
      for (const row of data) {
        if (!seen.has(row.warehouse_id)) {
          seen.add(row.warehouse_id);
          whs.push({ id: row.warehouse_id, name: row.warehouse_name });
        }
      }
      setWarehouses(whs);
    }).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const companyId = localStorage.getItem('company_id');
    if (!companyId) return;
    if (!warehouseId) { setError('Select a warehouse'); return; }

    setSaving(true);
    try {
      const res = await api.post<{ id: string }>('/inventory/counts', {
        company_id: companyId,
        warehouse_id: warehouseId,
        count_type: countType,
        notes: notes || null,
      });
      router.push(`/dashboard/inventory/counts/${res.id}`);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Failed to start count');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Start Stock Count</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Current stock quantities will be snapshotted as the system count. Enter physical counts on the next page.
        </p>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Warehouse *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Count Type *</label>
          <select value={countType} onChange={(e) => setCountType(e.target.value)} required
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {COUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            FULL = all items · CYCLE = subset · SPOT = spot check
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => router.back()}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Starting…' : 'Start count'}
          </button>
        </div>
      </form>
    </div>
  );
}
