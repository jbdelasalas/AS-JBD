'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { TableResizer } from '@/components/TableResizer';
import { SelectEnhancer } from '@/components/SelectEnhancer';
import { loadBranding } from '@/lib/branding';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    loadBranding();
    const token = localStorage.getItem('access_token');
    if (!token) {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    } else {
      // Default open on desktop, closed on mobile
      setSidebarOpen(window.innerWidth >= 768);
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500 dark:text-slate-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6 dark:bg-slate-800">
          <TableResizer />
          <SelectEnhancer />
          {children}
        </main>
      </div>
    </div>
  );
}
