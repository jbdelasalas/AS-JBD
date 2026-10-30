// Bin zones and the bin-code format, shared by the Bins page and /wms/bins.
// Kept free of server imports so the client page can use it.

export const BIN_TYPES = ['receiving', 'storage', 'picking', 'shipping'] as const;
export type BinType = (typeof BIN_TYPES)[number];

export interface BinZone {
  code: string;      // stored in bins.zone and used as the bin-code prefix
  label: string;
  binType: BinType;  // default type for a new bin in this zone
  dock: boolean;     // docks are numbered by lane, not rack + level
}

export const BIN_ZONES: BinZone[] = [
  { code: 'RCV', label: 'Receiving dock',                  binType: 'receiving', dock: true  },
  { code: 'CHL', label: 'Chiller (0–4 °C)',                binType: 'storage',   dock: false },
  { code: 'BLS', label: 'Blast freezer',                   binType: 'storage',   dock: false },
  { code: 'FRZ', label: 'Frozen storage (−18 °C)',         binType: 'storage',   dock: false },
  { code: 'DRY', label: 'Dry store (packaging, supplies)', binType: 'storage',   dock: false },
  { code: 'PCK', label: 'Pick face',                       binType: 'picking',   dock: false },
  { code: 'DSP', label: 'Dispatch dock',                   binType: 'shipping',  dock: true  },
];

const pad = (n: number) => String(n).padStart(2, '0');
export const RACKS  = Array.from({ length: 20 }, (_, i) => `R${pad(i + 1)}`);  // R01–R20
export const LEVELS = Array.from({ length: 5 },  (_, i) => `L${i + 1}`);       // L1–L5 (L1 = floor)
export const LANES  = Array.from({ length: 10 }, (_, i) => pad(i + 1));        // 01–10

export const zoneByCode = (code: string | null | undefined) => BIN_ZONES.find((z) => z.code === code);

/**
 * Bin code from its parts: rack zones give FRZ-R01-L2, docks give RCV-01.
 * Returns null when a part is missing or not on the lists above.
 */
export function buildBinCode(zone: string, parts: { rack?: string; level?: string; lane?: string }): string | null {
  const z = zoneByCode(zone);
  if (!z) return null;
  if (z.dock) return parts.lane && LANES.includes(parts.lane) ? `${z.code}-${parts.lane}` : null;
  if (!parts.rack || !RACKS.includes(parts.rack) || !parts.level || !LEVELS.includes(parts.level)) return null;
  return `${z.code}-${parts.rack}-${parts.level}`;
}
