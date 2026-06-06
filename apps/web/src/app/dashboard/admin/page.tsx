"use client";

import { useEffect, useRef, useState } from "react";
import {
  COLOR_THEMES, THEME_LABELS, THEME_SWATCH, ThemeKey,
  applyTheme, getBrandingBg, getBrandingTheme, saveBranding,
} from "@/lib/branding";
import { api } from "@/lib/api";

interface CompanyForm {
  name: string; legal_name: string; tin: string; rdo_code: string;
  address: string; phone: string; email: string; website: string; logo: string | null;
}

const EMPTY: CompanyForm = { name: '', legal_name: '', tin: '', rdo_code: '', address: '', phone: '', email: '', website: '', logo: null };

export default function AdminHomePage() {
  const [theme, setTheme] = useState<ThemeKey>("blue");
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [company, setCompany] = useState<CompanyForm>(EMPTY);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const [companySaved, setCompanySaved] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [companyError, setCompanyError] = useState<string | null>(null);

  useEffect(() => {
    setTheme(getBrandingTheme());
    setBgPreview(getBrandingBg());

    const id = localStorage.getItem('company_id');
    if (!id) { setCompanyLoading(false); return; }
    setCompanyId(id);
    api.get<CompanyForm & { id: string }>(`/companies/${id}`)
      .then((d) => {
        setCompany({ name: d.name, legal_name: d.legal_name ?? '', tin: d.tin ?? '', rdo_code: d.rdo_code ?? '', address: d.address ?? '', phone: d.phone ?? '', email: d.email ?? '', website: d.website ?? '', logo: d.logo ?? null });
        setLogoPreview(d.logo ?? null);
      })
      .catch((e) => setCompanyError((e as Error).message))
      .finally(() => setCompanyLoading(false));
  }, []);

  function compressImage(dataUrl: string, maxPx = 400): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        // If it fits within maxPx, return as-is — PNG transparency is preserved
        if (img.width <= maxPx && img.height <= maxPx) { resolve(dataUrl); return; }
        try {
          let w = img.width, h = img.height;
          if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png')); // PNG preserves transparency
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    });
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      setLogoPreview(raw);
      setCompany((c) => ({ ...c, logo: raw }));
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveCompany() {
    if (!companyId) {
      setCompanyError('No company selected. Please log out and log back in.');
      return;
    }
    setCompanyError(null);
    setCompanySaving(true);
    try {
      const payload = { ...company };
      if (payload.logo && payload.logo.startsWith('data:')) {
        payload.logo = await compressImage(payload.logo);
        setLogoPreview(payload.logo);
        setCompany((c) => ({ ...c, logo: payload.logo! }));
      }
      await api.put(`/companies/${companyId}`, payload);
      const token = localStorage.getItem('access_token');
      await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ company_name: company.name }),
      });
      localStorage.setItem('company_name', company.name);
      setCompanySaved(true);
      setTimeout(() => setCompanySaved(false), 3000);
    } catch (e: unknown) {
      setCompanyError((e as Error).message);
    } finally {
      setCompanySaving(false);
    }
  }

  async function handleSaveBranding() {
    await saveBranding(theme, bgPreview);
    setBrandSaved(true);
    setTimeout(() => setBrandSaved(false), 2000);
  }

  const field = (label: string, key: keyof CompanyForm, type = 'text', placeholder = '') => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        type={type}
        value={(company[key] as string) ?? ''}
        onChange={(e) => setCompany((c) => ({ ...c, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full rounded border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
      />
    </div>
  );

  const MODULES = [
    { href: '/dashboard/admin/master-data', title: 'Master Data', desc: 'Items, customers, suppliers, locations, buildings, departments, grow references', highlight: true },
    { href: '/dashboard/admin/users', title: 'Users', desc: 'Manage system users, passwords, and roles' },
    { href: '/dashboard/admin/employees', title: 'Employees', desc: 'Employee master data linked to user accounts' },
    { href: '/dashboard/admin/roles', title: 'Roles & Permissions', desc: 'Define roles and assign permissions per module' },
    { href: '/dashboard/admin/companies', title: 'Companies', desc: 'Company profile and BIR registration' },
    { href: '/dashboard/admin/fiscal-years', title: 'Fiscal Years', desc: 'Set up and close accounting periods' },
    { href: '/dashboard/admin/uoms', title: 'Units of Measure', desc: 'Manage units and conversion factors' },
    { href: '/dashboard/admin/payment-methods', title: 'Payment Methods', desc: 'Cash, check, bank, GCash, and card setups' },
    { href: '/dashboard/admin/document-series', title: 'Document Series', desc: 'Configure document numbering and prefixes' },
    { href: '/dashboard/admin/cost-centers', title: 'Cost Centers', desc: 'Departments and cost allocation centers' },
    { href: '/dashboard/admin/feature-flags', title: 'Feature Flags', desc: 'Enable or disable features per company' },
    { href: '/dashboard/admin/audit-log', title: 'Audit Log', desc: 'View all user activity and data changes' },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Administration</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Manage company details, branding, users, and roles.</p>
      </div>

      {/* Module navigation */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {MODULES.map((m) => (
          <a key={m.href} href={m.href}
            className={`rounded-lg border p-3 hover:shadow-sm transition-all ${
              (m as { highlight?: boolean }).highlight
                ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-slate-800 hover:border-brand-400'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-300 dark:hover:border-brand-600'
            }`}>
            <div className={`text-sm font-medium ${(m as { highlight?: boolean }).highlight ? 'text-brand-700 dark:text-brand-400' : 'text-slate-900 dark:text-slate-100'}`}>{m.title}</div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{m.desc}</div>
          </a>
        ))}
      </div>

      {/* ── Company Setup ── */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-5 text-sm font-semibold text-slate-800 dark:text-slate-200">Company Setup</h2>

        {companyLoading ? (
          <p className="text-xs text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-4">
            {/* Logo */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Company logo</label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="Logo" className="h-16 w-auto max-w-[160px] rounded border border-slate-200 dark:border-slate-700 object-contain p-1 dark:border-slate-600 bg-white" />
                ) : (
                  <div className="flex h-16 w-32 items-center justify-center rounded border-2 border-dashed border-slate-200 dark:border-slate-700 text-[11px] text-slate-400 dark:border-slate-600">No logo</div>
                )}
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => logoRef.current?.click()} className="rounded border border-slate-300 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {logoPreview ? 'Replace' : 'Upload logo'}
                  </button>
                  {logoPreview && (
                    <button onClick={() => { setLogoPreview(null); setCompany((c) => ({ ...c, logo: null })); }} className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {field('Company name', 'name', 'text', 'e.g. Perpet Pilipinas Corp.')}
              {field('Legal name', 'legal_name', 'text', 'Registered legal name')}
              {field('TIN', 'tin', 'text', '000-000-000-000')}
              {field('BIR RDO code', 'rdo_code', 'text', 'e.g. 040')}
              {field('Phone', 'phone', 'tel', '+63 2 8xxx xxxx')}
              {field('Email', 'email', 'email', 'info@company.com')}
              {field('Website', 'website', 'url', 'https://www.company.com')}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Address</label>
              <textarea
                value={company.address}
                onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))}
                rows={3}
                placeholder="Complete business address"
                className="w-full rounded border border-slate-300 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              />
            </div>

            {companyError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{companyError}</div>
            )}
            <button onClick={handleSaveCompany} disabled={companySaving}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              {companySaved ? '✓ Saved!' : companySaving ? 'Saving…' : 'Save company'}
            </button>
          </div>
        )}
      </div>

      {/* ── Login Page Branding ── */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Login Page Branding</h2>

        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Background image</p>
          {bgPreview ? (
            <div className="mb-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bgPreview} alt="Login background preview" className="h-40 w-full object-cover" />
            </div>
          ) : (
            <div className="mb-3 flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-400 dark:border-slate-600">
              No image — default background will be used
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="rounded border border-slate-300 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {bgPreview ? 'Replace image' : 'Upload image'}
            </button>
            {bgPreview && (
              <button onClick={() => { setBgPreview(null); if (fileRef.current) fileRef.current.value = ''; }} className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                Remove
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => setBgPreview(ev.target?.result as string); r.readAsDataURL(f); }} />
        </div>

        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">Theme color</p>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(COLOR_THEMES) as ThemeKey[]).map((t) => (
              <button key={t} onClick={() => { setTheme(t); applyTheme(t); }} title={THEME_LABELS[t]}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${theme === t ? 'border-slate-900 bg-slate-900 text-white shadow dark:border-white dark:bg-white dark:bg-slate-900 dark:text-slate-900 dark:text-slate-100' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: THEME_SWATCH[t] }} />
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleSaveBranding} className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          {brandSaved ? 'Saved!' : 'Save branding'}
        </button>
      </div>
    </div>
  );
}
