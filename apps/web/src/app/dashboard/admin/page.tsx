"use client";

import { useEffect, useRef, useState } from "react";
import {
  COLOR_THEMES,
  THEME_LABELS,
  THEME_SWATCH,
  ThemeKey,
  applyTheme,
  getBrandingBg,
  getBrandingTheme,
  saveBrandingBg,
  saveBrandingTheme,
} from "@/lib/branding";
import { useTheme } from "@/lib/theme";

export default function AdminHomePage() {
  const [theme, setTheme] = useState<ThemeKey>("blue");
  const [bgPreview, setBgPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { theme: darkMode, setTheme: setDarkMode } = useTheme();

  useEffect(() => {
    setTheme(getBrandingTheme());
    setBgPreview(getBrandingBg());
  }, []);

  function handleThemeSelect(t: ThemeKey) {
    setTheme(t);
    applyTheme(t);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBgPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleClearImage() {
    setBgPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSave() {
    saveBrandingTheme(theme);
    saveBrandingBg(bgPreview);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Administration</h1>
      <p className="mb-6 text-sm text-slate-600">Users, roles, audit log, companies and branches, fiscal periods.</p>

      {/* ── Login Page Branding ── */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Login Page Branding</h2>

        {/* Background image */}
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-slate-700">Background image</p>

          {bgPreview ? (
            <div className="mb-3 overflow-hidden rounded-lg border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgPreview}
                alt="Login background preview"
                className="h-40 w-full object-cover"
              />
            </div>
          ) : (
            <div className="mb-3 flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400">
              No image — default background will be used
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {bgPreview ? "Replace image" : "Upload image"}
            </button>
            {bgPreview && (
              <button
                onClick={handleClearImage}
                className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        {/* Dark / Light mode */}
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-slate-700">Display mode</p>
          <div className="flex gap-3">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setDarkMode(m)}
                className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium capitalize transition-all ${
                  darkMode === m
                    ? 'border-slate-900 bg-slate-900 text-white shadow dark:border-white dark:bg-white dark:text-slate-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {m === 'light' ? '☀ Light' : '☾ Dark'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Applies globally to all users.</p>
        </div>

        {/* Theme color */}
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium text-slate-700">Theme color</p>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(COLOR_THEMES) as ThemeKey[]).map((t) => (
              <button
                key={t}
                onClick={() => handleThemeSelect(t)}
                title={THEME_LABELS[t]}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  theme === t
                    ? "border-slate-900 bg-slate-900 text-white shadow"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: THEME_SWATCH[t] }}
                />
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {saved ? "Saved!" : "Save branding"}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-medium">Other modules not implemented yet</div>
        <p className="mt-1 text-xs leading-relaxed">
          The database schema and backend stub are in place. See{" "}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">apps/api/src/modules/admin/README.md</code>{" "}
          for what to build next.
        </p>
      </div>
    </div>
  );
}
