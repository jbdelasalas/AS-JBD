'use client';

import { useEffect, useState } from 'react';
import { useTheme } from '@/lib/theme';

export function TopBar({ onMenuToggle }: { onMenuToggle: () => void }) {
  const [userName, setUserName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') ?? 'null');
      if (user?.full_name) setUserName(user.full_name);
      const co = localStorage.getItem('company_name');
      if (co) setCompanyName(co);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-500 dark:bg-slate-600">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          aria-label="Toggle menu"
          className="flex h-8 w-8 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="text-sm text-slate-500 dark:text-slate-200">{companyName}</div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 dark:hover:text-white"
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m8.66-9h-1M4.34 12h-1m15.07-6.07-.71.71M6.34 17.66l-.71.71m12.02 0-.71-.71M6.34 6.34l-.71-.71M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <div className="text-xs text-slate-500 dark:text-slate-200">{userName}</div>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-medium text-brand-700">
          {userName ? userName.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase() : '??'}
        </div>
      </div>
    </header>
  );
}
