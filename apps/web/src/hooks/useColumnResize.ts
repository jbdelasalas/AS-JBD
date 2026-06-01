'use client';
import { useEffect, useRef, useState } from 'react';

export function useColumnResize(
  initial: Record<string, number>,
  storageKey: string,
) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const saved = localStorage.getItem(`col-widths:${storageKey}`);
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch {
      return initial;
    }
  });

  const drag = useRef<{ col: string; startX: number; startW: number } | null>(null);

  function onResizeStart(col: string, e: React.MouseEvent) {
    e.preventDefault();
    drag.current = { col, startX: e.clientX, startW: widths[col] ?? initial[col] ?? 100 };
  }

  useEffect(() => {
    function move(e: MouseEvent) {
      if (!drag.current) return;
      const { col, startX, startW } = drag.current;
      const next = Math.max(32, startW + e.clientX - startX);
      setWidths(w => ({ ...w, [col]: next }));
    }
    function up() {
      if (!drag.current) return;
      drag.current = null;
      setWidths(w => {
        try { localStorage.setItem(`col-widths:${storageKey}`, JSON.stringify(w)); } catch { /**/ }
        return w;
      });
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [storageKey]);

  // Returns inline style + the drag-handle div for each <th>
  function col(key: string, align: 'left' | 'right' | 'center' = 'left') {
    return {
      style: { width: widths[key], minWidth: widths[key] },
      resizeHandle: (
        <div
          onMouseDown={(e) => onResizeStart(key, e)}
          className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize group-hover:bg-brand-300/60 hover:!bg-brand-500 active:!bg-brand-600"
        />
      ),
    };
  }

  return { widths, col };
}
