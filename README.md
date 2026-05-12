# Perpet ERP

A modular ERP accounting system for Perpet Pilipinas Corp. — fuel wholesale and retail.

> ⚠️ **Status: Learning project / scaffolding.** This is a foundation, not a production system. The General Ledger module is functional end-to-end. All other modules are scaffolded with stubs, ready to be filled in incrementally. Do not run real money through this system without proper accounting review, security audit, and BIR CAS-PTU accreditation.

## Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + TailwindCSS
- **Backend**: NestJS + TypeScript + TypeORM
- **Database**: PostgreSQL 15+
- **Auth**: JWT (access + refresh tokens)
- **Monorepo**: npm workspaces

## Repository layout

```
perpet-erp/
├── apps/
│   ├── api/              NestJS backend (REST API)
│   └── web/              Next.js frontend
├── packages/
│   └── shared/           Shared TypeScript types between API and web
├── db/
│   ├── migrations/       Raw SQL migrations (run in order)
│   └── seeds/            Sample data (chart of accounts, demo company)
└── docs/                 Architecture and onboarding notes
```

## Module status

| Module | Backend | Frontend | Notes |
|---|---|---|---|
| Auth + RBAC | ✅ Functional | ✅ Functional | JWT, roles, permissions |
| Companies / branches | ✅ Functional | 🟡 Stub | Multi-entity foundation |
| General Ledger | ✅ Functional | ✅ Functional | CoA, journal entries, trial balance |
| Accounts Receivable | ✅ Functional | ✅ Functional | Customers, invoices, credit memos, collections, aging |
| Accounts Payable | 🟡 Stub | 🟡 Stub | Skeleton ready |
| Sales / CRM | ✅ Functional | ✅ Functional | Sales orders, delivery receipts, 7-status lifecycle |
| Purchasing | 🟡 Stub | 🟡 Stub | Skeleton ready |
| Inventory | 🟡 Stub | 🟡 Stub | Skeleton ready |
| Fuel ops (Perpet-specific) | 🟡 Stub | 🟡 Stub | Tank readings, deliveries |
| Reports | 🟡 Stub | 🟡 Stub | Trial Balance works; rest skeleton |
| BIR compliance | 🟡 Stub | 🟡 Stub | Document series wired in |

## Quick start

### Prerequisites

- Node.js 20 LTS
- PostgreSQL 15+ running locally
- npm 10+

### 1. Clone and install

```bash
git clone <your-repo-url> perpet-erp
cd perpet-erp
npm install
```

### 2. Database setup

Create the database:

```bash
createdb perpet_erp
```

Run migrations (in order):

```bash
psql perpet_erp -f db/migrations/001_init.sql
psql perpet_erp -f db/migrations/002_auth_rbac.sql
psql perpet_erp -f db/migrations/003_gl.sql
psql perpet_erp -f db/migrations/004_ar_ap.sql
psql perpet_erp -f db/migrations/005_inventory_sales_purch.sql
psql perpet_erp -f db/migrations/006_fuel.sql
psql perpet_erp -f db/migrations/007_bir.sql
```

Seed demo data:

```bash
psql perpet_erp -f db/seeds/001_demo_company.sql
psql perpet_erp -f db/seeds/002_chart_of_accounts.sql
psql perpet_erp -f db/seeds/003_demo_user.sql
```

### 3. Configure environment

Copy `.env.example` to `.env` in both apps:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/api/.env` with your Postgres credentials.

### 4. Run dev servers

In one terminal:
```bash
npm run dev:api
```

In another:
```bash
npm run dev:web
```

API: http://localhost:4000
Web: http://localhost:3000

### 5. Login

Default seeded credentials:
- Email: `admin@perpet.com.ph`
- Password: `Perpet2026!`

⚠️ Change this immediately in any non-local environment.

## What to build next (suggested order)

1. **Master your Chart of Accounts.** The seed file has a fuel-industry-aware CoA. Add/edit accounts via the GL screen. Post a few journal entries. Run the trial balance.

2. **Wire AR.** A sales invoice is just a journal entry plus a customer record and a document series. The skeleton in `apps/api/src/modules/ar/` shows what to fill in.

3. **Wire AP.** Mirror of AR with EWT (expanded withholding tax) handling — Perpet fuel purchases have specific WHT rates.

4. **Fuel module.** This is your differentiator vs. generic ERPs. Tank dip readings, temperature compensation, evaporation reconciliation. None of this is in BC by default.

5. **BIR forms.** 2550M (VAT), 1601-EQ (EWT), 2307. The data is already in your journal entries — these are just queries that aggregate and format.

## Important notes for a solo learner

- Don't try to build everything. Pick one module, get it production-quality (validation, tests, error handling, audit log), then move to the next.
- Every transaction should write to `audit_log`. Skipping this is the #1 way ERPs become untrustworthy.
- **Money is in `numeric(18, 4)`** — never `float`. There's a reason. Trust me.
- Write integration tests for posting logic. The day a journal entry posts unbalanced, you've lost the auditors.
- Read `docs/architecture.md` before adding modules.

## Deployment

This project deploys as: **Supabase** (database) + **Railway** (API) + **Vercel** (frontend).

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full step-by-step guide.

The TL;DR:
1. Push to GitHub
2. Create Supabase project, run `supabase/schema.sql` in SQL Editor
3. Connect Railway to the repo, set `DATABASE_URL` and JWT secrets
4. Connect Vercel to the repo (root: `apps/web`), set `NEXT_PUBLIC_API_URL`
5. Tighten CORS, change the default admin password, you're live

Cost: ~free for the first month, ~$10–15/month thereafter for light use.

## License

Internal use only — Perpet Pilipinas Corp.
