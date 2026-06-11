'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export type PortalCustomer = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('access_token');
    if (!token) {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    // Confirm this user is a portal customer; non-portal users go to dashboard.
    api
      .get<{ customer: PortalCustomer }>('/portal/me')
      .then((res) => {
        localStorage.setItem('portal_customer', JSON.stringify(res.customer));
        setReady(true);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          router.replace('/dashboard');
        } else {
          setError((e as Error).message ?? 'Failed to load portal');
          setReady(true);
        }
      });
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8] text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-800">
      {error && (
        <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">{error}</div>
      )}
      {children}
    </div>
  );
}
