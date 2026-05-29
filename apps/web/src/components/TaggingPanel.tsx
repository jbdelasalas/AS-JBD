'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Branch { id: string; code: string; name: string; }
interface Building { id: string; code: string; name: string; }
interface CostCenter { id: string; code: string; name: string; }
interface GrowRef { id: string; code: string; name: string; }

export interface TaggingValues {
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

interface Props {
  value: TaggingValues;
  onChange: (field: keyof TaggingValues, val: string) => void;
}

const sel = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

export function TaggingPanel({ value, onChange }: Props) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [growRefs, setGrowRefs] = useState<GrowRef[]>([]);

  useEffect(() => {
    const cid = localStorage.getItem('company_id');
    if (!cid) return;
    api.get<{ data: Branch[] }>(`/admin/branches?company_id=${cid}&limit=100`).then(r => setBranches(r.data ?? [])).catch(() => {});
    api.get<{ data: Building[] }>(`/poultry/buildings?company_id=${cid}&limit=100`).then(r => setBuildings(r.data ?? [])).catch(() => {});
    api.get<{ data: CostCenter[] }>(`/admin/cost-centers?company_id=${cid}&limit=100`).then(r => setCostCenters(r.data ?? [])).catch(() => {});
    api.get<{ data: GrowRef[] }>(`/poultry/grow-references?company_id=${cid}&limit=100`).then(r => setGrowRefs(r.data ?? [])).catch(() => {});
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 text-sm font-medium text-slate-700 dark:text-slate-300">P&amp;L Tagging</div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <label className={lbl}>Location (Branch)</label>
          <select value={value.branch_id} onChange={e => onChange('branch_id', e.target.value)} className={sel}>
            <option value="">— none —</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Building</label>
          <select value={value.building_id} onChange={e => onChange('building_id', e.target.value)} className={sel}>
            <option value="">— none —</option>
            {buildings.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Cost Center</label>
          <select value={value.cost_center_id} onChange={e => onChange('cost_center_id', e.target.value)} className={sel}>
            <option value="">— none —</option>
            {costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Grow</label>
          <select value={value.grow_reference_id} onChange={e => onChange('grow_reference_id', e.target.value)} className={sel}>
            <option value="">— none —</option>
            {growRefs.map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
