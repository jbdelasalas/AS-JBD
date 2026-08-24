# QR Inventory Movement — Module Manual

Scan-driven stock movement for the **Warehouse (WMS)** and the **Dressing
Plant**. Label a bin, a cold-storage box or a pallet with a QR sticker, then
move stock by scanning: *what am I moving* → *where is it going*.

- **Where:** Dashboard → **Warehouse → Scan & Move**, and
  Dashboard → **Dressing Plant → Scan & Move** (the same workbench).
- **Feature flags:** rides on the existing `wms` and `dressing_plant` flags.

---

## 1. Core idea

One registry table, `qr_labels`, maps a scanned **code** to the thing it names:

| Prefix | Entity | Table |
|--------|--------|-------|
| `BIN-` | Storage location | `bins` |
| `BOX-` | Cold-storage box | `dp_storage_boxes` |
| `PLT-` | Pallet (groups boxes) | `pallets` |

A code is `<PREFIX>-<32 hex>` — the entity's uuid with the dashes stripped
(`BIN-a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d`). Because the code is *derived* from the
row's id, a lost label can always be reprinted without a lookup, and the scanner
knows what kind of thing it has before touching the database.

**Boxes and pallets move. Bins are destinations.** That asymmetry is the whole
mental model of the floor UI.

---

## 2. Pages

| Page | What it does |
|------|--------------|
| **Scan & Move** | The two-step floor workflow. Scan a box/pallet, then a bin. |
| **QR Labels** | Issue and print stickers for bins, pallets and boxes. |
| **Pallets** | Create a pallet, then scan boxes onto it. |

---

## 3. The scan flow

```
Scan BOX-… or PLT-…        → "Holding: Dressed Chicken, 24 kg — now in WMS-STG-01"
Scan BIN-…                 → commits the move, posts bin stock, journals the scan
```

The destination scan **commits immediately** — no confirm tap. On a cold floor
with gloves on that tap is real friction, and the move is trivially reversible
by scanning the item back to its old bin. A short vibration confirms success
(or a triple-buzz on failure), because the screen often isn't visible.

Scanning a bin **first** (with nothing held) just reports what's in it.

### What a move actually posts

A move is bin-to-bin *within* the bin sub-ledger:

- `bin_stock_balances` — quantity leaves the source bin and lands in the
  destination, carrying the source bin's `avg_cost` so the move is cost-neutral.
- `inventory_scan_events` — one append-only row per moved thing.
- `dp_storage_boxes.bin_id` / `pallets.bin_id` — the new physical location.

Warehouse-level `stock_balances` is deliberately **not** touched: the warehouse
total hasn't changed. This is the same invariant the put-away route documents.

Everything runs in one transaction. If box 7 of a 20-box pallet fails its stock
check, the whole move rolls back rather than leaving a half-moved stack.

---

## 4. Scanning hardware

Both input methods are live on the same screen:

- **Phone camera** — uses the browser's built-in `BarcodeDetector`
  (Chrome/Android, Safari 17+). No decoding library is shipped. The button
  hides itself where the API is unavailable.
- **Scanner gun** — a USB/Bluetooth wedge types into the focused field and
  sends Enter. This is the fallback everywhere, and the primary input at a
  fixed receiving station.

Codes are normalised server-side, so all of these resolve to the same label:
trailing `\r\n` from a wedge, upper/lower-case variance, and a full deep-link
URL (`…/scan?code=BIN-…`) when the QR was printed for phone use.

A repeated scan of the same label inside 2.5 s is ignored, so a label sitting in
the camera's view doesn't fire dozens of times.

---

## 5. Pallets

A pallet groups boxes so one scan relocates the whole stack.

1. **Pallets → + New pallet** — auto-numbers `PLT-00001`, and issues its QR
   label immediately (a pallet you can't scan would be useless).
2. **Load boxes** — scan each box onto the pallet. This is a *stacking*
   operation: the box keeps its bin, and **no stock is posted**.
3. Move the pallet from **Scan & Move**. Every box on it moves in one
   transaction.

Only `open` pallets accept boxes; `shipped` pallets can't be moved.

---

## 6. Printing labels

**QR Labels** renders each sticker as inline SVG generated in the browser — no
network round-trip, no image assets, so printing works on a floor terminal with
flaky wifi.

- Filter by kind, click labels to select, then **Print**.
- **+ Label new bins / pallets / boxes** issues codes for anything not yet
  labelled — use it after creating bins in bulk.
- Printing stamps `printed_at`, so you can see what still needs a sticker.

Each label carries the QR plus the human-readable identity (bin code, warehouse,
zone), so a picker can read a bin without scanning it.

---

## 7. Setup

Run the migration once per environment:

```bash
curl -X POST https://<host>/api/v1/migrate-inventory-qr \
  -H 'Content-Type: application/json' \
  -d '{"secret":"migrate-as-jbd-2026"}'
```

It creates `pallets`, `qr_labels` and `inventory_scan_events`, adds
`pallet_id` / `bin_id` / `warehouse_id` / `item_id` / `lot_id` to
`dp_storage_boxes`, and **backfills a label for every existing bin and
in-storage box** — so the feature is usable the moment it ships. Idempotent, and
runs against both the `public` and `sandbox` schemas.

---

## 8. Traceability

`inventory_scan_events` is append-only: entity, code, from-bin, to-bin, item,
lot, qty, who scanned it and when. Moves made together share a `move_ref`, so a
20-box pallet move is one logical event. Zero-quantity moves are journalled too
(relocating an empty pallet), so the floor history is complete.

The last 15 movements show under the scanner as a live activity feed.

---

## 9. Boundaries

- A move never crosses into GL postings — it relocates stock, it doesn't
  revalue it.
- Boxes with no `item_id` (plant-only boxes that never entered WMS) still move
  and are still journalled; they simply post no bin stock.
- Labels are company-scoped on resolve, so a code from another tenant is
  rejected rather than acted on.
