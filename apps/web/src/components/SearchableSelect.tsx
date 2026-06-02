'use client';

import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
}

export function SearchableSelect({
  value, onChange, options, placeholder = '— select —',
  className = '', required, disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const VISIBLE_CAP = 100;

  // Filter options by query
  const allFiltered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  const filtered = allFiltered.slice(0, VISIBLE_CAP);
  const truncated = allFiltered.length > VISIBLE_CAP;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSelect(opt: SelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'Enter' && filtered.length === 1) { handleSelect(filtered[0]); e.preventDefault(); }
  }

  const base = `relative w-full rounded border text-sm ${
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  } border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 ${className}`;

  return (
    <div ref={containerRef} className={base}>
      {/* Display box */}
      <div
        onClick={handleOpen}
        className="flex items-center gap-1 px-2 py-1.5 min-h-[34px]"
      >
        <span className={`flex-1 truncate text-sm ${!selected ? 'text-slate-400 dark:text-slate-500' : ''}`}>
          {open
            ? <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type to search…"
                onClick={e => e.stopPropagation()}
                className="w-full bg-transparent outline-none text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            : (selected?.label ?? placeholder)
          }
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs leading-none px-0.5"
              tabIndex={-1}
            >×</button>
          )}
          <svg className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </div>

      {/* Hidden native select for form validation */}
      {required && (
        <select
          value={value}
          onChange={() => {}}
          required={required}
          tabIndex={-1}
          aria-hidden
          className="absolute inset-0 opacity-0 pointer-events-none"
        >
          <option value="" />
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-60 overflow-auto rounded border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
          ) : (
            <>
              {filtered.map(opt => (
                <div
                  key={opt.value}
                  onMouseDown={() => handleSelect(opt)}
                  className={`cursor-pointer px-3 py-1.5 text-sm truncate hover:bg-brand-50 dark:hover:bg-slate-700 ${
                    opt.value === value ? 'bg-brand-50 text-brand-700 font-medium dark:bg-slate-700 dark:text-brand-400' : 'text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {opt.label}
                </div>
              ))}
              {truncated && (
                <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-700">
                  Showing {VISIBLE_CAP} of {allFiltered.length} — type to filter
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
