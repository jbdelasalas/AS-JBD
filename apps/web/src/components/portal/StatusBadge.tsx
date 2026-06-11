'use client';

const STYLES: Record<string, string> = {
  'Pending':           'bg-amber-100 text-amber-800',
  'Approved':          'bg-sky-100 text-sky-800',
  'Allocated':         'bg-indigo-100 text-indigo-800',
  'Truck Assigned':    'bg-violet-100 text-violet-800',
  'Ready to Dispatch': 'bg-cyan-100 text-cyan-800',
  'Out for Delivery':  'bg-blue-100 text-blue-800',
  'Delivered':         'bg-green-100 text-green-800',
  'Cancelled':         'bg-slate-200 text-slate-600',
  'Rejected':          'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {status}
    </span>
  );
}
