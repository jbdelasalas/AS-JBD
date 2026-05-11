'use client';

import { useEffect, useState } from 'react';

export function TopBar() {
  const [userName, setUserName] = useState('');
  const [companyName, setCompanyName] = useState('');

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
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div className="text-sm text-slate-500">{companyName || 'Perpet Pilipinas Corp.'}</div>
      <div className="flex items-center gap-3">
        <div className="text-xs text-slate-500">{userName}</div>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-medium text-brand-700">
          {userName ? userName.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase() : '??'}
        </div>
      </div>
    </header>
  );
}
