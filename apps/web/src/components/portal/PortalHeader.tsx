'use client';

import Link from 'next/link';

export function PortalHeader({
  subtitle = 'ORDER ONLINE · TRACK REAL-TIME',
  backHref,
  backLabel,
}: {
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="bg-[#1e2a44] text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-2xl shadow">
            🐔
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight sm:text-lg">
              Art Fresh Chicken <span className="font-semibold text-white/80">— Customer Portal</span>
            </h1>
            <p className="text-[11px] tracking-wide text-white/55">{subtitle}</p>
          </div>
        </div>
        {backHref && (
          <Link href={backHref} className="text-sm text-white/80 hover:text-white">
            ← {backLabel ?? 'Back'}
          </Link>
        )}
      </div>
    </header>
  );
}

export function PortalFooter() {
  return (
    <footer className="py-8 text-center text-xs text-slate-400">
      Art Fresh Chicken Corp. · Luzon Operations
    </footer>
  );
}
