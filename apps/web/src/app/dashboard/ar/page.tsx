"use client";

export default function ArHomePage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Accounts Receivable</h1>
      <p className="mb-6 text-sm text-slate-600">Customers, sales invoices, customer payments and aging.</p>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-medium">Module not implemented yet</div>
        <p className="mt-1 text-xs leading-relaxed">
          The database schema and backend stub are in place. See{" "}
          <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px]">apps/api/src/modules/ar/README.md</code>{" "}
          for what to build next.
        </p>
      </div>
    </div>
  );
}
