# Fuel module (stub) — Perpet's differentiator

Fuel-specific operations that generic ERPs do not handle well.

## Tables already in DB

- `fuel_tanks` — storage tank master
- `tank_readings` — physical dip / ATG measurements
- `fuel_deliveries` — inbound from refineries with temperature-corrected volumes
- `pumps`, `pump_readings` — retail dispensing equipment
- `retail_shifts` — attendant shift records with cash reconciliation
- `fuel_reconciliations` — daily book-vs-measured stock matching

## Why fuel is different

1. **Volume changes with temperature.** Trade is settled in **litres at 15°C (L15)**.
   - At ambient 30°C, the same product has greater observed volume than at 15°C.
   - You buy in L15, you sell in observed L (because pumps don't temperature-correct).
   - The difference is real, recurring, and must be tracked.

2. **Density varies.** Diesel ~0.832 kg/L, Gasoline 91 ~0.732 kg/L. You'll see both
   weight (MT) and volume (L) on supplier docs.

3. **Excise tax is significant.** RA 10963 (TRAIN Law) sets specific excise rates
   per litre per fuel type (currently ₱10/L diesel, ₱10/L gasoline 91, etc.).
   Tracked in `items.excise_tax_per_unit`. This is in addition to 12% VAT.

4. **Evaporation and shrinkage.** Within ~0.5% is normal and goes to `5210
   Inventory variance — evaporation`. Beyond that triggers investigation.

## What to implement next

### Phase 1 — Tank readings (easy win)

- **POST `/fuel/tanks/:id/readings`** — operator records dip + temperature.
- Compute L15 using API/ASTM volume correction tables (look up by product type and
  observed temperature). For a learning project, start with a simplified formula:
  `L15 = observed × (1 - 0.0009 × (observed_temp_c - 15))` for diesel.
- Show last reading and trend on a tank dashboard.

### Phase 2 — Inbound deliveries

- **POST `/fuel/deliveries`** — record refinery delivery.
- On post:
  - Insert `stock_movements` (movement_type='receipt') for `received_litres_15c` at
    unit_cost computed from bill total / received_litres_15c.
  - Update `stock_balances` for the depot warehouse + product.
  - Auto-create the AP bill if not already linked.
  - Generate JE: `Dr Inventory + Dr Excise Prepaid + Dr Input VAT / Cr AP`.

### Phase 3 — Daily reconciliation

- For each tank for each day:
  - opening_book = closing_book of previous day
  - receipts = sum of fuel_deliveries posted that day for this tank
  - sales = sum of pump_readings deltas for pumps drawing from this tank
  - closing_book = opening + receipts − sales
  - measured = latest tank_reading.litres_at_15c on that day
  - variance = measured − closing_book
- If |variance / sales| > 0.5%, status='draft' requiring review.
- On approval, post JE: `Dr Inventory variance / Cr Inventory` (or reverse for gain).

### Phase 4 — Retail station shifts

- **POST `/fuel/shifts/:id/close`** — attendant ends shift.
- Pull start/end pump readings, compute litres dispensed × selling price.
- Reconcile against cash + card + cheque collected.
- Generate sales invoices (cash sales) and a JE for the day's pump activity.

## Important: Do NOT post inventory at observed volume

Always convert to L15 before persisting to `stock_movements` and
`stock_balances`. Otherwise your inventory will swing with ambient temperature and
your COGS will be unreliable.
