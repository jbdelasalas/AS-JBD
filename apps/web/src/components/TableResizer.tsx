'use client';

/**
 * Drop this once into the dashboard layout.
 * It watches for any <table> in the page, injects a drag-handle on the right
 * edge of every <th>, and stores the resulting column widths in localStorage
 * keyed by page path + column index.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function TableResizer() {
  const pathname = usePathname();

  useEffect(() => {
    const storageKey = `col-widths:${pathname}`;

    // Restore saved widths from localStorage
    function restoreWidths(table: HTMLTableElement, tableIdx: number) {
      try {
        const saved: Record<string, number> = JSON.parse(
          localStorage.getItem(`${storageKey}:t${tableIdx}`) ?? '{}'
        );
        const ths = table.querySelectorAll<HTMLElement>(':scope > thead > tr > th');
        ths.forEach((th, colIdx) => {
          const w = saved[String(colIdx)];
          if (w) { th.style.width = `${w}px`; th.style.minWidth = `${w}px`; }
        });
      } catch { /**/ }
    }

    // Add drag handles to every <th> in this table
    function instrument(table: HTMLTableElement, tableIdx: number) {
      if ((table as HTMLElement & { _resizable?: boolean })._resizable) return;
      (table as HTMLElement & { _resizable?: boolean })._resizable = true;

      // Make the table use fixed layout so column widths are respected
      table.style.tableLayout = 'fixed';

      restoreWidths(table, tableIdx);

      const ths = table.querySelectorAll<HTMLElement>(':scope > thead > tr > th');
      ths.forEach((th, colIdx) => {
        if (th.querySelector('.col-resize-handle')) return;

        th.style.position = 'relative';
        th.style.overflow = 'hidden';
        th.style.userSelect = 'none';

        const handle = document.createElement('div');
        handle.className = 'col-resize-handle';
        Object.assign(handle.style, {
          position: 'absolute',
          top: '0',
          right: '0',
          bottom: '0',
          width: '5px',
          cursor: 'col-resize',
          zIndex: '10',
          backgroundColor: 'transparent',
          transition: 'background-color 0.15s',
        });
        handle.addEventListener('mouseenter', () => { handle.style.backgroundColor = 'rgba(99,102,241,0.4)'; });
        handle.addEventListener('mouseleave', () => { handle.style.backgroundColor = 'transparent'; });

        let startX = 0;
        let startW = 0;

        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          startX = e.clientX;
          startW = th.offsetWidth;
          handle.style.backgroundColor = 'rgba(99,102,241,0.7)';

          function onMove(mv: MouseEvent) {
            const next = Math.max(40, startW + mv.clientX - startX);
            th.style.width = `${next}px`;
            th.style.minWidth = `${next}px`;
          }

          function onUp() {
            handle.style.backgroundColor = 'transparent';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            // Persist
            try {
              const saved: Record<string, number> = JSON.parse(
                localStorage.getItem(`${storageKey}:t${tableIdx}`) ?? '{}'
              );
              saved[String(colIdx)] = th.offsetWidth;
              localStorage.setItem(`${storageKey}:t${tableIdx}`, JSON.stringify(saved));
            } catch { /**/ }
          }

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        th.appendChild(handle);
      });
    }

    // Instrument all tables currently in the DOM
    function scanTables() {
      document.querySelectorAll<HTMLTableElement>('table').forEach((t, i) => instrument(t, i));
    }

    scanTables();

    // Watch for tables added dynamically (e.g. after data loads)
    const observer = new MutationObserver(scanTables);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => { observer.disconnect(); };
  }, [pathname]);

  return null;
}
