'use client';

import { useRef, useState } from 'react';

export interface CsvColumn {
  key: string;
  header: string;
}

interface Props {
  rows: Record<string, unknown>[];
  exportColumns: CsvColumn[];
  filename: string;
  importColumns?: CsvColumn[];
  onImportRow?: (row: Record<string, string>) => Promise<void>;
  onImportComplete?: () => void;
}

function toCsv(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(',')).join('\n');
  return body ? `${header}\n${body}` : header;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): { headers: string[]; records: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (!lines.length) return { headers: [], records: [] };
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  const records = lines.slice(1).filter((l) => l.trim()).map((line) => {
    const vals = line.split(',').map((v) => v.replace(/^"|"$/g, '').trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
  return { headers, records };
}

interface Result { row: number; status: 'ok' | 'error'; message?: string; }

export default function ImportExportButtons({
  rows,
  exportColumns,
  filename,
  importColumns,
  onImportRow,
  onImportComplete,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  function handleExport() {
    download(`${filename}.csv`, toCsv(exportColumns, rows));
  }

  function handleTemplate() {
    const cols = importColumns ?? exportColumns;
    download(`${filename}-template.csv`, toCsv(cols, []));
    setImportOpen(false);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onImportRow) return;
    setImportOpen(false);
    setImporting(true);
    setResults(null);
    const text = await file.text();
    const { records } = parseCsv(text);
    const out: Result[] = [];
    for (let i = 0; i < records.length; i++) {
      try {
        await onImportRow(records[i]);
        out.push({ row: i + 1, status: 'ok' });
      } catch (err) {
        out.push({ row: i + 1, status: 'error', message: (err as Error).message });
      }
    }
    setResults(out);
    setImporting(false);
    if (e.target) e.target.value = '';
    if (onImportComplete) onImportComplete();
  }

  const okCount = results?.filter((r) => r.status === 'ok').length ?? 0;
  const errCount = results?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={handleExport}
        className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Export CSV
      </button>

      {onImportRow && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setImportOpen((o) => !o)}
            disabled={importing}
            className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import CSV ▾'}
          </button>
          {importOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
              <button
                type="button"
                onClick={handleTemplate}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Download template
              </button>
              <button
                type="button"
                onClick={() => { setImportOpen(false); fileRef.current?.click(); }}
                className="flex w-full items-center gap-2 border-t border-slate-100 dark:border-slate-700 px-3 py-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Upload CSV…
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </div>
      )}

      {results && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Import complete</span>
            <button type="button" onClick={() => setResults(null)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <div className="mb-2 flex gap-3 text-xs">
            <span className="text-emerald-700">{okCount} succeeded</span>
            {errCount > 0 && <span className="text-red-600">{errCount} failed</span>}
          </div>
          {results.filter((r) => r.status === 'error').slice(0, 5).map((r) => (
            <div key={r.row} className="text-[11px] text-red-600">Row {r.row}: {r.message}</div>
          ))}
          {errCount > 5 && <div className="text-[11px] text-slate-500">…and {errCount - 5} more errors</div>}
        </div>
      )}
    </div>
  );
}
