# Dressing Plant — Module Manual

Poultry **tolling** operations for AFCC: the plant receives a client's live birds,
dresses/processes them, stores and dispatches the product, and bills the client
for the service. This module runs the whole floor-to-invoice flow and derives the
accounting automatically.

- **Status:** Live (production). Opt-in via the `dressing_plant` feature flag.
- **Where:** Dashboard → **Dressing Plant**.
- **Enable/disable:** Administration → Feature Flags → `dressing_plant`.

---

## 1. Core idea — two keys tie everything together

1. **Every operational row carries a batch** (`dp_job_orders.id`). A batch is one
   booking / job order.
2. **Every billable row also carries a client** (`dp_clients.id`), which is linked
   to an ERP **customer** (Receivables → Customers). You pick a customer as
   "Bill To"; the tolling-client record is created/linked for you.

**Operations write facts; accounting reads them.** The floor never touches journal
entries. A single posting engine (`dp_post_journal`) converts operational events
into balanced, idempotent double-entry postings in the shared General Ledger.

---

## 2. The eight sub-modules

| # | Page | What it does | Posts to GL? |
|---|------|--------------|:---:|
| A | **Job Orders** | Book an incoming batch (LBRS): Bill To, farm location, expected arrival, truck plate, expected heads, remarks. Booking # is auto-assigned. | No |
| B | **Receiving** | Live-bird receiving: gross/tare, head & coop counts, DOA. Recording it **locks the batch**. | No |
| C | **Yield & WIP** | Dressed recovery, offal, condemned. Live recovery %; fires **mass-balance** (>1.5% loss) and **low-recovery** (<75%) alerts. | No |
| C+ | **Production Detail** | Processed output **per product (ERP item) and per size**. A **Transfer to WMS** button pushes it into bin stock and creates cold-storage boxes for billing. | No (moves stock) |
| D | **Marination** | Recipe BOM explosion consumes ingredient inventory. | **Yes** — Dr DP5220 / Cr DP1145 |
| E | **Cold Chain** | Storage boxes with a barcode UUID (CCPT). Hourly storage clock accrues daily rental. | (accruals; invoice on billing) |
| F | **Invoices** | Generate the basic-tolling invoice for a batch (idempotent). | **Yes** — Dr DP1130 / Cr DP4100 |
| G | **Dispatch & Gate** | Bundle boxes into a delivery order, then issue a gate pass. **Release is blocked until the batch's invoices clear and every box scans.** | No |
| H | **Sanitation & PM** | Machinery runtime, maintenance work orders, and sanitation chemical logs. | **Yes** — Dr DP5230 / Cr DP1140 |

---

## 3. Chart of accounts (dedicated `DP####` range)

The module uses its **own** account codes so they never collide with a company's
existing chart. Seeded automatically for every company on migration.

| Code | Account | Type |
|------|---------|------|
| DP1130 | Accounts Receivable — Tolling | Asset |
| DP1140 | Inventory — Processing Supplies | Asset |
| DP1145 | Inventory — Marination Ingredients | Asset |
| DP1150 | Inventory — Maintenance Spare Parts | Asset |
| DP4100 | Tolling Revenue — Basic Dressing | Revenue |
| DP4200 | Tolling Revenue — Cut-Ups & Portioning | Revenue |
| DP4300 | Tolling Revenue — Marination Services | Revenue |
| DP4400 | Warehousing Revenue — Blast Freezing | Revenue |
| DP4450 | Warehousing Revenue — Cold Storage | Revenue |
| DP4500 | Sales of By-Products / DOA Penalty | Revenue |
| DP5220 | Marination Raw Materials | Expense |
| DP5230 | Food-grade Sanitation Chemicals | Expense |
| DP5340 | Repairs & Maintenance — Plant Machinery | Expense |

### Posting rules (event → Dr / Cr)

| Event | Dr | Cr |
|-------|----|----|
| Generate tolling invoice | DP1130 AR | DP4100 Basic Tolling |
| Cut-up invoice | DP1130 AR | DP4200 Cut-Ups |
| Marination invoice | DP1130 AR | DP4300 Marination |
| Blast-freeze invoice | DP1130 AR | DP4400 Blast |
| Storage invoice | DP1130 AR | DP4450 Cold Storage |
| DOA penalty | DP1130 AR | DP4500 By-Products |
| Marination BOM consumed | DP5220 Materials | DP1145 Inventory |
| Sanitation chemical used | DP5230 Chemicals | DP1140 Supplies |
| Maintenance completed | DP5340 R&M | DP1150 Spares |

> **Rate cards are effective-dated** — an invoice uses the rate live on the batch
> date, so updating a rate never rewrites a historical bill.

---

## 4. End-to-end walkthrough (with the seeded demo)

A complete example already exists in production: batch **`DEMO-DP-0001`**
(Jollibee Foods Corp.). Follow along, or reproduce it with:

```bash
POSTGRES_URL="…:6543/postgres" node db/seeds/dressing_plant_demo.cjs
```

### Step 1 — Book the batch (Job Orders)
1. Go to **Dressing Plant → Job Orders**.
2. **Bill To** = a customer (e.g. Jollibee Foods Corp.). Fill Farm Location,
   Expected Arrival, Truck Plate, Expected Heads, Remarks.
3. Click **+ Create Booking**. The **Booking #** and **Status** fill in
   (e.g. `DP-2026-00001`, status `received`).

### Step 2 — Receive & weigh (Receiving)
1. Go to **Receiving**, pick the batch.
2. Enter Gross, Tare, Heads, Coops, DOA. Net live weight = gross − tare.
   *(Demo: gross 3600, tare 100 → 3500 kg net; 2000 heads, 15 DOA.)*
3. **Record receiving** → the batch **locks** and moves to `processing`.

### Step 3 — Record yield (Yield & WIP)
1. Go to **Yield & WIP**, pick the batch. Net live prefills.
2. Enter Dressed, Offal, Condemned. *(Demo: dressed 2730 → **78% recovery**.)*
3. Save. Alerts appear if unaccounted loss > 1.5% or recovery < 75%.

### Step 3b — Production detail + Transfer to WMS (Production Detail)
1. Go to **Production Detail**, pick the batch.
2. Add lines: **Product** (an ERP item, e.g. Dressed Chicken), **Size**
   (XS/S/M/L/XL/Jumbo), packs, heads, weight. Save.
   *(Demo: M = 400 kg, L = 300 kg.)*
3. Under **Transfer to WMS**, pick a warehouse + bin and click
   **→ Transfer to WMS**. Each line becomes:
   - a **lot** `<batch>-<size>` (e.g. `DEMO-DP-0001-M`) for traceability,
   - **bin stock** in the chosen bin,
   - a **cold-storage box** so the storage clock/billing starts.
   Re-running is idempotent — transferred lines are skipped.
   *Sizes are managed under the size list (seeded XS…Jumbo); products are your
   inventory items, so stock maps straight into WMS.*

### Step 4 — Store product (Cold Chain)
1. Go to **Cold Chain**, pick the batch. Enter Product, Net kg, Pallet, Room.
2. **Store** → a box with a barcode UUID appears (`in_storage`).
3. **Run storage clock** accrues daily rental for boxes held over 24h.

### Step 5 — Invoice (Invoices)
1. Go to **Invoices**, pick the batch, **Generate tolling invoice**.
2. Billable heads = received − DOA. *(Demo: 2000 − 15 = 1985 × ₱18 = **₱35,730**.)*
3. This posts **Dr DP1130 / Cr DP4100** — check it in General Ledger → Journal
   Entries (demo entry `JV-2026-000047`). Re-clicking is a no-op (idempotent).

### Step 6 — Dispatch & release (Dispatch & Gate)
1. Go to **Dispatch & Gate**. Select in-storage boxes + client, **Create DO**.
2. **Issue gate pass** — the server re-checks:
   - every invoice on the batch is `paid` / `cleared` / `credit_approved`, and
   - the scanned box count matches the DO.
   If either fails, release is **blocked**. On success, boxes flip to
   `dispatched` and the DO is `released`.

### Step 7 — Maintenance & sanitation (Sanitation & PM)
- Register machinery (runtime + service threshold); overdue assets flag red.
- Raise work orders (preventive/corrective).
- Log sanitation chemical use → posts **Dr DP5230 / Cr DP1140**.

---

## 5. Automation

| Job | Trigger | Action |
|-----|---------|--------|
| **Storage clock** (`dp_run_storage_clock`) | Hourly (cron) or the button on Cold Chain | Accrues daily rental for boxes > 24h in storage; idempotent per box per day. |
| **Batch lock** | On receiving insert | Locks the batch, sets status `processing`. |
| **Recovery / mass-balance alerts** | On yield save | Surfaces in the Yield page response. |
| **IoT ingestion** (`/api/v1/dressing-plant/device/ping`) | Hour meters / scales POST with `x-device-secret` | Lands in `dp_device_pings`; hour-meter pings bump machinery runtime. |

---

## 6. Security notes

- **Gate release is enforced server-side and in the DB**, not client JS. The
  `dp_gate_passes.accounting_status` CHECK only permits `paid` / `cleared` /
  `credit_approved`; the API re-validates invoice clearance and box scan count
  before issuing a pass.
- Postings run only through `dp_post_journal`, which validates that debits equal
  credits and refuses to post into a **closed fiscal period**.

---

## 7. Data model (tables)

`dp_clients` · `dp_rate_cards` · `dp_posting_rules` · `dp_job_orders` ·
`dp_receiving_weights` · `dp_processing_logs` · `dp_yield_records` ·
`dp_labor_logs` · `dp_utility_readings` · `dp_recipes` · `dp_bom_items` ·
`dp_marination_runs` · `dp_storage_boxes` · `dp_storage_accruals` · `dp_invoices` ·
`dp_delivery_orders` · `dp_do_lines` · `dp_gate_passes` · `dp_assets_machinery` ·
`dp_machinery_runtime` · `dp_work_orders` · `dp_sanitation_logs` · `dp_device_pings`

**Functions:** `dp_post_journal`, `dp_generate_tolling_invoice`,
`dp_run_storage_clock`, `dp_bootstrap_defaults`, `dp_lock_batch_on_receiving`.

---

## 8. Open decisions (confirm with the CPA)

1. **Marination posting direction** — implemented as Dr DP5220 / Cr DP1145
   (consumption). The original spec's wording was the reverse; this follows the
   consumption convention consistent with sanitation and maintenance.
2. **Credit release** — gate pass allows `credit_approved`. Confirm whether AFCC
   actually extends tolling credit or every release is prepaid/cleared.
3. **BOM costing** — ingredient consumption uses weighted-average (matching the
   rest of inventory).

---

## 9. API reference

All under `/api/v1/dressing-plant/`, authenticated, scoped by `company_id`:

`clients` · `job-orders` · `receiving` · `yield` · `recipes` · `marination` ·
`cold-chain` · `cold-chain/run-clock` · `invoices` · `delivery-orders` ·
`gate-passes` · `sanitation` · `work-orders` · `assets` · `rate-cards` ·
`device/ping` (device-secret auth, not user JWT).
