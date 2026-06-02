'use client';
import { useEffect, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ColDef<T = any> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  exportValue?: (row: T) => string;
  align?: 'left' | 'right';
}

interface Props<T extends object> {
  id: string;
  columns: ColDef<T>[];
  rows: T[];
  exportRows?: T[];      // rows to use for CSV (defaults to rows)
  loading?: boolean;
  emptyMessage?: string;
  filename?: string;
  showExport?: boolean;  // set false when the parent already provides export
  footer?: React.ReactNode; // rendered as <tfoot> inside the table
  children?: React.ReactNode;
}

function toCsv<T extends object>(cols: ColDef<T>[], rows: T[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map(c => esc(c.header)).join(',');
  const body = rows
    .map(r => cols.map(c => esc(c.exportValue ? c.exportValue(r) : (r as Record<string,unknown>)[c.key])).join(','))
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function DataTable<T extends object>({
  id, columns, rows, exportRows, loading, emptyMessage = 'No records found.', filename, showExport = true, footer, children,
}: Props<T>) {
  const defaultOrder = () => columns.map(c => c.key);

  const [colOrder, setColOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaultOrder();
    try {
      const saved = JSON.parse(localStorage.getItem(`dt-${id}`) ?? 'null') as string[] | null;
      if (Array.isArray(saved) && saved.length && saved.every(k => columns.some(c => c.key === k)))
        return saved;
    } catch { /* ignore */ }
    return defaultOrder();
  });

  // Keep order consistent if columns change (new col added, old removed)
  useEffect(() => {
    const keys = columns.map(c => c.key);
    const merged = [
      ...colOrder.filter(k => keys.includes(k)),
      ...keys.filter(k => !colOrder.includes(k)),
    ];
    if (merged.join() !== colOrder.join()) setColOrder(merged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns.map(c => c.key).join()]);

  const orderedCols = colOrder
    .map(k => columns.find(c => c.key === k))
    .filter(Boolean) as ColDef<T>[];

  function saveOrder(order: string[]) {
    setColOrder(order);
    try { localStorage.setItem(`dt-${id}`, JSON.stringify(order)); } catch { /* ignore */ }
  }

  // Drag-and-drop state
  const dragSrc = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  function onDragStart(e: React.DragEvent, i: number) {
    dragSrc.current = i;
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(i);
  }
  function onDrop(e: React.DragEvent, i: number) {
    e.preventDefault();
    const src = dragSrc.current;
    if (src === null || src === i) { setDragOver(null); return; }
    const next = [...colOrder];
    const [moved] = next.splice(src, 1);
    next.splice(i, 0, moved);
    saveOrder(next);
    dragSrc.current = null;
    setDragOver(null);
  }
  function onDragEnd() { setDragOver(null); dragSrc.current = null; }

  const n = orderedCols.length;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Export toolbar */}
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5">
        <span className="text-[11px] text-slate-400 dark:text-slate-500 select-none">
          Drag column headers to reorder
        </span>
        {showExport && (
          <button
            type="button"
            onClick={() => download(`${filename ?? id}.csv`, toCsv(orderedCols, (exportRows ?? rows) as T[]))}
            className="flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M8 12l4 4m0 0l4-4m-4 4V4" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <tr>
              {orderedCols.map((col, i) => (
                <th
                  key={col.key}
                  draggable
                  onDragStart={e => onDragStart(e, i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDrop={e => onDrop(e, i)}
                  onDragEnd={onDragEnd}
                  className={[
                    'px-3 py-2 font-medium select-none cursor-grab active:cursor-grabbing transition-colors',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    dragOver === i
                      ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border-l-2 border-brand-400'
                      : '',
                  ].join(' ')}
                >
                  <span className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : ''}`}>
                    {/* grip icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-30 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/>
                      <circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                    </svg>
                    {col.header}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={n} className="px-3 py-8 text-center text-xs text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={n} className="px-3 py-8 text-center text-xs text-slate-400">{emptyMessage}</td></tr>
            ) : rows.map((row, ri) => (
              <tr
                key={String((row as Record<string,unknown>).id ?? ri)}
                className="border-b border-slate-50 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {orderedCols.map(col => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {children}
    </div>
  );
}
