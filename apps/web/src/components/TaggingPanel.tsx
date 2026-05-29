'use client';
import { type TaggingData } from '@/hooks/useTaggingData';

export interface TaggingValues {
  branch_id: string;
  building_id: string;
  cost_center_id: string;
  grow_reference_id: string;
}

const sel = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const lbl = 'mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400';

interface Props {
  value: TaggingValues;
  data: TaggingData;
  onChange: (field: keyof TaggingValues, val: string) => void;
}

export function TaggingFields({ value, data, onChange }: Props) {
  return (
    <>
      <div>
        <label className={lbl}>Location</label>
        <select value={value.branch_id} onChange={e => onChange('branch_id', e.target.value)} className={sel}>
          <option value="">— none —</option>
          {data.branches.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Building</label>
        <select value={value.building_id} onChange={e => onChange('building_id', e.target.value)} className={sel}>
          <option value="">— none —</option>
          {data.buildings.map(b => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Cost Center</label>
        <select value={value.cost_center_id} onChange={e => onChange('cost_center_id', e.target.value)} className={sel}>
          <option value="">— none —</option>
          {data.costCenters.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Grow</label>
        <select value={value.grow_reference_id} onChange={e => onChange('grow_reference_id', e.target.value)} className={sel}>
          <option value="">— none —</option>
          {data.growRefs.map(g => <option key={g.id} value={g.id}>{g.code} — {g.name}</option>)}
        </select>
      </div>
    </>
  );
}

interface GrowSelectProps {
  value: string;
  data: TaggingData;
  onChange: (val: string) => void;
}

export function GrowSelect({ value, data, onChange }: GrowSelectProps) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full rounded border border-slate-300 px-1 py-1 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
      <option value="">—</option>
      {data.growRefs.map(g => <option key={g.id} value={g.id}>{g.code}</option>)}
    </select>
  );
}
