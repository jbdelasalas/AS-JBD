'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Employee {
  id: string;
  employee_no: string;
  full_name: string;
  position: string | null;
  department_name: string | null;
}

interface Vehicle {
  id: string;
  plate_no: string;
  description: string | null;
  default_product: string | null;
  tank_capacity_l: number | null;
  assigned_employee_name: string | null;
  is_active: boolean;
}

const ENTITIES = ['PPC', 'ARTPRO', 'ARTFRESH', 'JHTC'];
const PRODUCTS = ['diesel', 'gasoline', 'premium', 'kerosene', 'other'];

const inputCls =
  'w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const labelCls = 'mb-1 block text-xs text-slate-600 dark:text-slate-400';

export default function NewFuelPOSlipPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entityCode, setEntityCode] = useState('ARTFRESH');
  const [slipNo, setSlipNo] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [issuedToName, setIssuedToName] = useState('');
  const [positionDept, setPositionDept] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [product, setProduct] = useState('diesel');
  const [quantity, setQuantity] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');

  const companyId = typeof window !== 'undefined' ? localStorage.getItem('company_id') : null;

  useEffect(() => {
    if (!companyId) return;
    api.get<Employee[]>(`/admin/employees?company_id=${companyId}`)
      .then(setEmployees).catch(() => {});
    api.get<{ data: Vehicle[] }>(`/fuel/vehicles?company_id=${companyId}&active=true`)
      .then((r) => setVehicles(r.data)).catch(() => {});
  }, [companyId]);

  // Picking an employee fills the name and position/dept exactly as they'd be
  // hand-written on the pad — still editable, since slips go to non-employees too.
  function pickEmployee(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    if (emp) {
      setIssuedToName(emp.full_name);
      setPositionDept([emp.position, emp.department_name].filter(Boolean).join(' / '));
    }
  }

  function pickVehicle(id: string) {
    setVehicleId(id);
    const v = vehicles.find((x) => x.id === id);
    if (v) {
      setPlateNo(v.plate_no);
      if (v.default_product) setProduct(v.default_product);
    }
  }

  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const overTank =
    selectedVehicle?.tank_capacity_l != null &&
    quantity !== '' &&
    Number(quantity) > selectedVehicle.tank_capacity_l;

  async function save(thenIssue: boolean) {
    setError(null);
    if (!companyId) { setError('No company selected'); return; }
    if (!issuedToName.trim()) { setError('“Issued to” is required'); return; }
    if (quantity !== '' && Number(quantity) <= 0) { setError('Quantity must be greater than 0'); return; }

    setSaving(true);
    try {
      const slip = await api.post<{ id: string; slip_no: string }>('/fuel/po-slips', {
        company_id: companyId,
        slip_no: slipNo.trim() || undefined,
        entity_code: entityCode,
        employee_id: employeeId || null,
        issued_to_name: issuedToName.trim(),
        position_dept: positionDept.trim() || null,
        vehicle_id: vehicleId || null,
        plate_no: plateNo.trim() || null,
        product,
        quantity_litres: quantity === '' ? null : Number(quantity),
        issue_date: issueDate,
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
      });

      if (thenIssue) {
        await api.post(`/fuel/po-slips/${slip.id}/issue`);
      }
      router.push(`/dashboard/fuel/po-slips/${slip.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link href="/dashboard/fuel/po-slips" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
          ← Back to slips
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">New Gas P.O. Slip</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Fill in the issued-to portion. The station accomplishes the rest at the pump.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-12 gap-3">

          <div className="col-span-12 sm:col-span-4">
            <label className={labelCls}>Company / Entity *</label>
            <select value={entityCode} onChange={(e) => setEntityCode(e.target.value)} className={inputCls}>
              {ENTITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="col-span-12 sm:col-span-4">
            <label className={labelCls}>Slip No.</label>
            <input
              value={slipNo}
              onChange={(e) => setSlipNo(e.target.value)}
              placeholder="6616 — from the booklet"
              className={inputCls}
            />
            <p className="mt-1 text-[10px] text-slate-400">Leave blank to auto-number.</p>
          </div>

          <div className="col-span-12 sm:col-span-4">
            <label className={labelCls}>Issue date *</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
          </div>

          <div className="col-span-12"><hr className="border-slate-200 dark:border-slate-700" /></div>

          <div className="col-span-12 sm:col-span-6">
            <label className={labelCls}>Employee</label>
            <select value={employeeId} onChange={(e) => pickEmployee(e.target.value)} className={inputCls}>
              <option value="">— not an employee / manual entry —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.employee_no} — {e.full_name}</option>
              ))}
            </select>
          </div>

          <div className="col-span-12 sm:col-span-6">
            <label className={labelCls}>Issued to *</label>
            <input
              value={issuedToName}
              onChange={(e) => setIssuedToName(e.target.value)}
              placeholder="Jay Chris delas Alas"
              className={inputCls}
            />
          </div>

          <div className="col-span-12 sm:col-span-6">
            <label className={labelCls}>Position / Dept.</label>
            <input
              value={positionDept}
              onChange={(e) => setPositionDept(e.target.value)}
              placeholder="Finance"
              className={inputCls}
            />
          </div>

          <div className="col-span-12 sm:col-span-6">
            <label className={labelCls}>Vehicle</label>
            <select value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} className={inputCls}>
              <option value="">— none / rented unit —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate_no}{v.description ? ` — ${v.description}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-12 sm:col-span-4">
            <label className={labelCls}>Vehicle / Plate No.</label>
            <input
              value={plateNo}
              onChange={(e) => setPlateNo(e.target.value.toUpperCase())}
              placeholder="NJH 4714"
              className={`${inputCls} font-mono`}
            />
          </div>

          <div className="col-span-6 sm:col-span-4">
            <label className={labelCls}>Product *</label>
            <select value={product} onChange={(e) => setProduct(e.target.value)} className={`${inputCls} capitalize`}>
              {PRODUCTS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
            </select>
          </div>

          <div className="col-span-6 sm:col-span-4">
            <label className={labelCls}>Quantity in Liters</label>
            <input
              type="number" min="0" step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="50"
              className={inputCls}
            />
            {overTank && (
              <p className="mt-1 text-[10px] text-amber-600">
                Above the {selectedVehicle?.tank_capacity_l} L tank capacity on file.
              </p>
            )}
          </div>

          <div className="col-span-12">
            <label className={labelCls}>Purpose</label>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Delivery run — Batangas"
              className={inputCls}
            />
          </div>

          <div className="col-span-12">
            <label className={labelCls}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & Issue'}
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Save as Draft
          </button>
          <Link
            href="/dashboard/fuel/po-slips"
            className="rounded px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Cancel
          </Link>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          “Save &amp; Issue” approves the slip under your name and makes it ready to print.
        </p>
      </div>
    </div>
  );
}
