# Warehouse Management System (WMS) — Module Manual

Bin-level inventory on top of the existing warehouse/stock model: bins, lot &
serial tracking, put-away, picking and shipping. Opt-in via the `wms` feature
flag.

- **Where:** Dashboard → **Warehouse**.
- **Enable/disable:** Administration → Feature Flags → `wms`.

---

## 1. Core idea

The base ERP tracks stock at the **warehouse** level (`stock_balances`). WMS adds a
**bin** sub-ledger (`bin_stock_balances`) inside each warehouse, plus optional
**lot** and **serial** tracking per item. Warehouse-level balances are left
untouched, so existing inventory logic keeps working; WMS is an additional layer.

Each item has a `tracking_mode`: `none`, `lot`, or `serial`.

---

## 2. Pages

| Page | What it does |
|------|--------------|
| **Bins** | Define storage locations per warehouse (zone + type: receiving / storage / picking / staging / shipping). |
| **Bin Stock** | On-hand quantity per item, per bin, per lot. |
| **Put-away** | Move received goods into bins (posts to `bin_stock_balances`). |
| **Pick Lists** | Pick stock from bins to fulfil a sales order. |
| **Shipments** | Ship picked stock (draws bin stock down). |
| **Lots & Serials** | Lot/serial master per item. |

---

## 3. Flow

```
Goods receipt → Put-away (into bins) → Bin stock
   → Pick list (from bins, per sales order) → Shipment (out) → Bin stock down
```

Lots carry an expiry date, enabling FEFO (first-expiry-first-out) picking.

---

## 4. Sample data (seeded in production)

Warehouse **Distribution**, ART FRESH CHICKEN CORP. Reproduce with:

```bash
POSTGRES_URL="…:6543/postgres" node db/seeds/wms_demo.cjs
```

It creates:
- **5 bins**: `WMS-RCV-01` (receiving), `WMS-STG-01` / `WMS-STG-02` (storage),
  `WMS-PCK-01` (picking), `WMS-SHP-01` (shipping).
- **Grower Pellets** set to **lot-tracked**, with lots `LOT-2026-A` and
  `LOT-2026-B` (B nearer expiry).
- **Put-away `PUT-DEMO-0001`** (posted): 300 bags lot A → STG-01, 150 bags lot B
  → STG-02, 5000 day-old chicks → STG-01.
- **Pick `PICK-DEMO-0001`** + **Shipment `SHIP-DEMO-0001`**: 100 bags of lot A
  shipped.

Resulting bin stock:

| Bin | Item | Lot | Qty |
|-----|------|-----|----:|
| WMS-STG-01 | Grower Pellets | LOT-2026-A | 200 |
| WMS-STG-01 | Ross 308 Day-Old Chicks | — | 5000 |
| WMS-STG-02 | Grower Pellets | LOT-2026-B | 150 |

### Walkthrough
1. **Warehouse → Bins** — see the 5 seeded bins for Distribution.
2. **Bin Stock** — confirm the quantities above (lot A = 300 put away − 100
   shipped = 200).
3. **Put-away** — open `PUT-DEMO-0001` to see the three lines.
4. **Pick Lists** — `PICK-DEMO-0001` (status *picked*).
5. **Shipments** — `SHIP-DEMO-0001` (status *shipped*, carrier JRS Express).
6. **Lots & Serials** — the two Grower Pellet lots with expiry dates.

---

## 5. Data model

`bins` · `item_lots` · `item_serials` · `bin_stock_balances` · `putaways` /
`putaway_lines` · `pick_lists` / `pick_list_lines` · `shipments` /
`shipment_lines`. `stock_movements` gains `bin_id` / `lot_id` columns.

## 6. API

Under `/api/v1/wms/`: `bins` · `warehouses` · `items` · `stock-on-hand` ·
`putaways` · `pick-lists` · `shipments` · `lots`.
