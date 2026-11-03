// Short/over heads and reseko (live → dressed weight %) for dressing-plant batches.
//   expected heads = received − DOA;  short/over = produced − expected
//   reseko % = dressed kg (production lines) ÷ net live kg (receiving) × 100

export interface YieldInput {
  received: number | null;   // heads received (null = not received)
  doa: number;
  liveKg: number;            // net live weight from receiving
  producedHeads: number;
  dressedKg: number;
}

export function batchYield(y: YieldInput) {
  const expected = y.received == null ? null : y.received - (y.doa || 0);
  const diff = expected == null ? null : y.producedHeads - expected;
  const reseko = y.liveKg > 0 ? (y.dressedKg / y.liveKg) * 100 : null;
  return { expected, diff, reseko };
}

const int = (n: number) => n.toLocaleString();
const kg = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** "Short 12" / "Over 3" / "Exact", coloured. */
export function ShortOver({ diff }: { diff: number | null }) {
  if (diff == null) return <span className="text-slate-400">—</span>;
  if (diff === 0) return <span className="text-emerald-600">Exact</span>;
  return diff < 0
    ? <span className="font-medium text-red-600">Short {int(-diff)}</span>
    : <span className="font-medium text-amber-600">Over {int(diff)}</span>;
}

export function BatchYieldStrip({ input, note }: { input: YieldInput; note?: string }) {
  const { expected, diff, reseko } = batchYield(input);
  const cell = 'rounded border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900';
  const label = 'text-[11px] text-slate-500 dark:text-slate-400';
  const value = 'text-sm font-semibold text-slate-900 dark:text-slate-100';
  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <div className={cell}><div className={label}>Heads received</div><div className={value}>{input.received == null ? '—' : int(input.received)}</div></div>
        <div className={cell}><div className={label}>DOA</div><div className={value}>{int(input.doa || 0)}</div></div>
        <div className={cell}><div className={label}>Expected (rcv − DOA)</div><div className={value}>{expected == null ? '—' : int(expected)}</div></div>
        <div className={cell}><div className={label}>Heads produced</div><div className={value}>{int(input.producedHeads)}</div></div>
        <div className={cell}><div className={label}>Short / over</div><div className="text-sm"><ShortOver diff={diff} /></div></div>
        <div className={cell}><div className={label}>Live → dressed kg</div><div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{kg(input.liveKg)} → {kg(input.dressedKg)}</div></div>
        <div className={cell}><div className={label}>Reseko</div><div className={value}>{reseko == null ? '—' : `${reseko.toFixed(2)}%`}</div></div>
      </div>
      {note && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  );
}
