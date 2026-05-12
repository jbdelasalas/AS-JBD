'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { LoginResponse } from '@perpet/shared';
import { loadBranding, getBrandingBg } from '@/lib/branding';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@perpet.com.ph');
  const [password, setPassword] = useState('Perpet2026!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginBg, setLoginBg] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState('');

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
      if (res.companies.length > 0) {
        localStorage.setItem('company_id', res.companies[0].id);
        localStorage.setItem('company_name', res.companies[0].name);
      }
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
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
      {/* dark overlay so the form stays readable over the photo */}
      <div className="absolute inset-0 bg-black/55" />

      <div className="relative z-10 w-full max-w-sm rounded-lg border border-white/10 bg-white/10 p-8 shadow-xl backdrop-blur-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-white">ERP System</h1>
          {companyName && <p className="mt-1 text-xs text-white/60">{companyName}</p>}
        </div>

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

        <p className="mt-6 text-center text-xs text-white/40">
          Default: admin@perpet.com.ph / Perpet2026!
        </p>
      </div>
    </div>
  );
}
