# Deployment guide — Supabase + Railway + Vercel

This guide takes you from "I have the zip" to "live on the internet" in roughly
60–90 minutes. The pattern matches your HRIS workflow with one extra service
(Railway for the API).

## Architecture

```
        ┌─────────────────┐
 user ──▶│  Vercel         │   Next.js frontend (apps/web)
        │  *.vercel.app   │
        └────────┬────────┘
                 │ HTTPS
                 ▼
        ┌─────────────────┐
        │  Railway        │   NestJS API (apps/api)
        │  *.railway.app  │
        └────────┬────────┘
                 │ Postgres protocol (SSL)
                 ▼
        ┌─────────────────┐
        │  Supabase       │   PostgreSQL (db/)
        │  *.supabase.co  │
        └─────────────────┘
```

Three services, one git repo. Each platform watches a branch and auto-deploys on
push.

---

## Step 1 — Push to GitHub

You need a private repo because the seed file contains a default password hash.

```bash
cd perpet-erp
git init
git add .
git commit -m "Initial commit: Perpet ERP scaffolding"
gh repo create perpet-erp --private --source=. --push
# Or use the GitHub UI, then:
# git remote add origin https://github.com/YOU/perpet-erp.git
# git push -u origin main
```

---

## Step 2 — Provision the database (Supabase)

1. Go to https://supabase.com → **New Project**
   - Name: `perpet-erp` (or anything you like)
   - Database password: generate a strong one and save it to your password manager
   - Region: **Southeast Asia (Singapore)** — closest to Manila
2. Wait ~2 minutes for provisioning
3. **Run the schema:**
   - Sidebar → **SQL Editor** → **New query**
   - Open `supabase/schema.sql` from your project, copy the whole file, paste, click **Run**
   - You should see "Success. No rows returned" plus output messages
4. **Verify it worked:**
   - Sidebar → **Table Editor** — you should see ~40 tables including `accounts`, `journal_entries`, `fuel_tanks`
   - Run in SQL Editor: `SELECT count(*) FROM accounts;` — should return 88
5. **Get the connection string:**
   - Sidebar → **Project Settings** → **Database**
   - Scroll to **Connection string** → **Session pooler** (port 5432, NOT 6543)
   - Copy the URI. It looks like:
     `postgres://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
   - Replace `[YOUR-PASSWORD]` with the password from step 1
   - **Save this string** — you'll need it for Railway

> **Why the session pooler not transaction pooler?** The transaction pooler (port
> 6543) breaks `SET` statements and prepared statements, which TypeORM uses. Use
> session mode for traditional Node.js backends; reserve transaction mode for
> serverless / Edge functions.

---

## Step 3 — Deploy the API (Railway)

1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Select your `perpet-erp` repo
3. Railway will detect the `railway.json` and use the Dockerfile in `apps/api/`
4. Click **Variables** and add:

   ```
   NODE_ENV=production
   DATABASE_URL=<paste the Supabase URL from Step 2.5>
   JWT_ACCESS_SECRET=<generate: openssl rand -hex 48>
   JWT_REFRESH_SECRET=<generate a different one: openssl rand -hex 48>
   JWT_ACCESS_EXPIRES=15m
   JWT_REFRESH_EXPIRES=7d
   WEB_ORIGIN=https://*.vercel.app
   ```

   To generate the JWT secrets, run locally:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Click **Deploy**. First build takes ~3–5 minutes.
6. Once deployed, click **Settings** → **Networking** → **Generate Domain**
   You'll get something like `perpet-erp-api-production.up.railway.app`
7. **Test it:** open `https://YOUR-RAILWAY-DOMAIN/api/v1/health` — should return:
   ```json
   {"status":"ok","db":true,"uptime_seconds":12,"timestamp":"..."}
   ```
   Open `https://YOUR-RAILWAY-DOMAIN/api/docs` — should show the Swagger UI

If the health check fails:
- "db: false" → the `DATABASE_URL` is wrong. Re-copy from Supabase, paste exactly.
- 502 Bad Gateway → check Railway logs (Deployments → View Logs). Common cause:
  build succeeded but app crashed at startup.

---

## Step 4 — Deploy the frontend (Vercel)

1. Go to https://vercel.com → **Add New** → **Project**
2. Import your `perpet-erp` repo
3. **Configure Project**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: **`apps/web`** (click Edit and select)
   - Build Command: leave default — Vercel will use `vercel.json`
   - Install Command: leave default
4. **Environment Variables** — add:
   ```
   NEXT_PUBLIC_API_URL=https://YOUR-RAILWAY-DOMAIN/api/v1
   ```
   (use the Railway URL from Step 3.6)
5. Click **Deploy**. First build takes ~2–3 minutes.
6. Once deployed, you'll get `https://perpet-erp-XXXX.vercel.app`

---

## Step 5 — Tighten CORS

After the first Vercel deploy, you have a real production URL. Update Railway:

1. Railway → your project → **Variables**
2. Change `WEB_ORIGIN` from `https://*.vercel.app` to:
   ```
   https://perpet-erp-XXXX.vercel.app,https://*.vercel.app
   ```
   (Add your stable production URL first; keep the wildcard for preview deploys.)
3. Railway will redeploy automatically.

---

## Step 6 — Test end-to-end

1. Open `https://perpet-erp-XXXX.vercel.app`
2. Login with `admin@perpet.com.ph` / `Perpet2026!`
3. **Change the password immediately** (you can't yet through the UI — for now,
   regenerate the hash and update via Supabase SQL Editor; build a "change
   password" page in week 2):

   ```sql
   -- In Supabase SQL Editor
   -- First generate a new hash locally:
   --   node -e "console.log(require('bcryptjs').hashSync('YOUR-NEW-PASSWORD', 10))"
   UPDATE users
   SET password_hash = '$2a$10$....your-new-hash....'
   WHERE email = 'admin@perpet.com.ph';
   ```

4. Browse the chart of accounts (88 accounts)
5. Create a journal entry, post it, check trial balance — should balance ✓

---

## Continuous deployment

Every push to `main` will:
- Railway: rebuild and redeploy the API (~3 min)
- Vercel: rebuild and redeploy the frontend (~2 min)
- Supabase: nothing — DB schema only changes when you run SQL manually

For database schema changes, write a new migration file in `db/migrations/`
and run it via Supabase SQL Editor. Never run `synchronize: true` against
Supabase — keep schema changes versioned in git.

---

## Cost estimate (small usage)

| Service | Free tier | Paid tier (light use) |
|---|---|---|
| Supabase | 500MB DB, 50k MAU | $25/mo (Pro) |
| Railway | $5 free credit/mo | $5–10/mo |
| Vercel | Unlimited for hobby | $20/mo (Pro) — only if you need teams |
| **Total** | **~free first month** | **~$10–15/mo** |

You'll hit Railway paid before anything else because the API is always-on.
Supabase Pro becomes necessary once you exceed 500MB or want point-in-time
recovery.

---

## Common production issues

**"too many connections" from Postgres** — switch from session pooler to
transaction pooler in DATABASE_URL (port 6543), but you'll need to disable
TypeORM's prepared statements:
```ts
// In app.module.ts useFactory:
{ ..., extra: { statement_timeout: 60000, prepareStatement: false } }
```

**Cold starts on Railway** — Railway keeps your container warm. If you ever
move to a serverless host (Vercel Functions, AWS Lambda), expect 1-3 second
cold starts on first request. The Supabase transaction pooler is required
there.

**CORS errors** — Vercel preview URLs change with every PR. Either set
`WEB_ORIGIN=https://*.vercel.app` (less secure) or add specific URLs as needed.

**Migration failed on Supabase** — Supabase enables RLS on a few internal
tables by default. Our schema doesn't conflict but if you ever see "row-level
security policy violation," check that your tables are in the `public` schema.

---

## What you should NOT do

- **Do not commit `.env` files.** Only `.env.example` belongs in git. The seed
  file's bcrypt hash is the one and only password we publish.
- **Do not enable Supabase Auth alongside our JWT auth** without thinking it
  through. We have our own `users` table; Supabase Auth has its own
  `auth.users`. Mixing them creates a mess. Pick one.
- **Do not run `synchronize: true`** in TypeORM. Ever. It will drop columns.
- **Do not run real money through this** until you've added tests, monitoring,
  daily backups verified by restore, and BIR CAS PTU accreditation.
