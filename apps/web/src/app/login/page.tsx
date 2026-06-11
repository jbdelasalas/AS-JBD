'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { LoginResponse } from '@perpet/shared';
import { loadBranding, getBrandingBg } from '@/lib/branding';

type Company = { id: string; code: string; name: string };

// Only honour same-origin relative paths to avoid open-redirect issues.
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (raw === '/login' || raw.startsWith('/login?')) return '/dashboard';
  return raw;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@afcc.ph');
  const [password, setPassword] = useState('artfresh2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginBg, setLoginBg] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [pendingCompanies, setPendingCompanies] = useState<Company[] | null>(null);

  useEffect(() => {
    loadBranding();
    setLoginBg(getBrandingBg());
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then((d) => { if (d?.company_name) setCompanyName(d.company_name); })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', { email, password });
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('user', JSON.stringify(res.user));
      localStorage.setItem('permissions', JSON.stringify(res.permissions));
      localStorage.setItem('companies', JSON.stringify(res.companies));

      if (res.companies.length === 0) {
        setError('No companies are assigned to your account.');
        return;
      }
      if (res.companies.length === 1) {
        localStorage.setItem('company_id', res.companies[0].id);
        localStorage.setItem('company_name', res.companies[0].name);
        await routeAfterLogin();
      } else {
        setPendingCompanies(res.companies);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function selectCompany(company: Company) {
    localStorage.setItem('company_id', company.id);
    localStorage.setItem('company_name', company.name);
    await routeAfterLogin();
  }

  // Portal customers go straight to /portal; everyone else to the dashboard
  // (or the requested ?next= target).
  async function routeAfterLogin() {
    const explicitNext = new URLSearchParams(window.location.search).get('next');
    if (explicitNext) {
      router.replace(safeNext(explicitNext));
      return;
    }
    try {
      const me = await api.get<{ customer?: { id: string } }>('/portal/me');
      if (me?.customer?.id) {
        router.replace('/portal');
        return;
      }
    } catch {
      // not a portal user (403) — fall through to dashboard
    }
    router.replace('/dashboard');
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{
        backgroundImage: `url('${loginBg ?? '/login-bg.jpg'}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="absolute inset-0 bg-black/55" />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-white/10 bg-white/10 p-8 shadow-xl backdrop-blur-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">ERP System</h1>
          {companyName && <p className="mt-1 text-xs text-white/60">{companyName}</p>}
        </div>

        {pendingCompanies ? (
          <div>
            <p className="mb-4 text-center text-sm text-white/80">Select a company to continue</p>
            <div className="space-y-2">
              {pendingCompanies.map((co) => (
                <button
                  key={co.id}
                  onClick={() => selectCompany(co)}
                  className="w-full rounded border border-white/20 bg-white/10 px-4 py-3 text-left text-sm text-white hover:bg-white/20 focus:outline-none focus:ring-1 focus:ring-brand-400"
                >
                  <div className="font-medium">{co.name}</div>
                  <div className="text-xs text-white/50">{co.code}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setPendingCompanies(null)}
              className="mt-4 w-full text-center text-xs text-white/50 hover:text-white/80"
            >
              Back to login
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/80">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full rounded border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>

            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        )}

        {!pendingCompanies && (
          <p className="mt-6 text-center text-xs text-white/40">
            Default: admin@afcc.ph / artfresh2026
          </p>
        )}
      </div>
    </div>
  );
}
