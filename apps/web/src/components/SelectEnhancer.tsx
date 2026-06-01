'use client';

/**
 * Drop once into the dashboard layout.
 * Intercepts every native <select> in the page and replaces its native
 * dropdown with a searchable overlay: shows the full list, filters as
 * you type, and dispatches a real change event so React state updates.
 */

import { useEffect } from 'react';

export function SelectEnhancer() {
  useEffect(() => {
    let overlay: HTMLDivElement | null = null;
    let activeSelect: HTMLSelectElement | null = null;

    function isDark() {
      return document.documentElement.classList.contains('dark');
    }

    function removeOverlay() {
      overlay?.remove();
      overlay = null;
      activeSelect = null;
    }

    function selectOption(select: HTMLSelectElement, value: string) {
      // Trigger React's synthetic onChange by using the native setter
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      removeOverlay();
    }

    function buildOverlay(select: HTMLSelectElement) {
      removeOverlay();
      activeSelect = select;

      const rect = select.getBoundingClientRect();
      const dark = isDark();

      // Container
      const div = document.createElement('div');
      div.setAttribute('data-sel-enhancer', '1');
      Object.assign(div.style, {
        position: 'fixed',
        zIndex: '99999',
        width: `${Math.max(rect.width, 220)}px`,
        background: dark ? '#1e293b' : '#fff',
        border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '260px',
      });

      // Position: below the select, flip up if not enough room
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedH = 260;
      if (spaceBelow >= estimatedH || spaceBelow >= spaceAbove) {
        div.style.top = `${rect.bottom + 2}px`;
      } else {
        div.style.bottom = `${window.innerHeight - rect.top + 2}px`;
      }
      div.style.left = `${Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8)}px`;

      // Search input
      const searchWrap = document.createElement('div');
      Object.assign(searchWrap.style, {
        padding: '6px 8px',
        borderBottom: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        flexShrink: '0',
      });
      const searchInput = document.createElement('input');
      searchInput.placeholder = 'Type to search…';
      Object.assign(searchInput.style, {
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${dark ? '#475569' : '#cbd5e1'}`,
        borderRadius: '4px',
        padding: '4px 8px',
        fontSize: '12px',
        outline: 'none',
        background: dark ? '#0f172a' : '#f8fafc',
        color: dark ? '#e2e8f0' : '#0f172a',
      });
      searchWrap.appendChild(searchInput);
      div.appendChild(searchWrap);

      // Options list
      const list = document.createElement('div');
      Object.assign(list.style, { overflowY: 'auto', flex: '1' });
      div.appendChild(list);

      const allOptions = Array.from(select.options);

      function renderOptions(query: string) {
        list.innerHTML = '';
        const q = query.toLowerCase();
        const filtered = q ? allOptions.filter(o => o.text.toLowerCase().includes(q)) : allOptions;

        if (!filtered.length) {
          const empty = document.createElement('div');
          Object.assign(empty.style, { padding: '8px 12px', fontSize: '12px', color: dark ? '#94a3b8' : '#94a3b8' });
          empty.textContent = 'No matches';
          list.appendChild(empty);
          return;
        }

        for (const opt of filtered) {
          const selected = opt.value === select.value;
          const item = document.createElement('div');
          Object.assign(item.style, {
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '13px',
            color: selected
              ? (dark ? '#93c5fd' : '#1d4ed8')
              : (dark ? '#e2e8f0' : '#1e293b'),
            background: selected ? (dark ? '#1e3a5f' : '#eff6ff') : 'transparent',
            fontWeight: selected ? '500' : 'normal',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          });
          item.title = opt.text;
          item.textContent = opt.text;

          item.addEventListener('mouseenter', () => {
            if (!selected) item.style.background = dark ? '#1e293b' : '#f1f5f9';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = selected ? (dark ? '#1e3a5f' : '#eff6ff') : 'transparent';
          });
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectOption(select, opt.value);
          });

          list.appendChild(item);
        }
      }

      renderOptions('');

      searchInput.addEventListener('input', () => renderOptions(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { removeOverlay(); select.focus(); }
        if (e.key === 'Enter') {
          const first = list.querySelector('div') as HTMLElement | null;
          first?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        if (e.key === 'Tab') removeOverlay();
      });

      document.body.appendChild(div);
      // Small delay so the select's own focus completes first
      setTimeout(() => searchInput.focus(), 10);

      overlay = div;
    }

    // Intercept mousedown on <select> to prevent native dropdown
    function onMouseDown(e: MouseEvent) {
      const sel = e.target as HTMLElement;
      if (sel.tagName !== 'SELECT') return;
      e.preventDefault();
      const select = sel as HTMLSelectElement;
      if (overlay && activeSelect === select) {
        removeOverlay();
        return;
      }
      buildOverlay(select);
    }

    // Also handle focus via keyboard (Tab)
    function onKeyDown(e: KeyboardEvent) {
      const sel = e.target as HTMLElement;
      if (sel.tagName !== 'SELECT') return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        buildOverlay(sel as HTMLSelectElement);
      }
    }

    // Close on outside click
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!overlay) return;
      if (!overlay.contains(target) && target.tagName !== 'SELECT') {
        removeOverlay();
      }
    }

    // Close on scroll/resize
    function onScroll() { removeOverlay(); }

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      removeOverlay();
    };
  }, []);

  return null;
}
