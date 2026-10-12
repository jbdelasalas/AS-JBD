// Address → coordinates for the trip planner. Server-only.
//
// Google Geocoding when GOOGLE_MAPS_API_KEY is set (fast, good with Philippine
// barangay addresses); otherwise OpenStreetMap's Nominatim, which is free but
// allows one request a second and is weaker on PH street addresses. Either way
// every answer is remembered in geocode_cache, so an address costs one lookup
// ever, and a pin someone drags by hand (source 'manual') is never overwritten.
//
// A guess is "precise" when it landed on a street or building. An area-level
// hit (barangay, town) is still returned so the stop shows on the map, but the
// planner flags it for a human to drag into place.

import { query } from '@/lib/db';

export interface GeoHit {
  lat: number;
  lng: number;
  formatted: string | null;
  source: 'google' | 'nominatim' | 'manual';
  precise: boolean;
}

export function addressKey(address: string): string {
  return address.toLowerCase().replace(/[\s,]+/g, ' ').trim();
}

async function viaGoogle(address: string, key: string): Promise<GeoHit | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'ph');
  url.searchParams.set('components', 'country:PH');
  url.searchParams.set('key', key);
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Google geocoding failed (${r.status})`);
  const body = await r.json() as {
    status: string; error_message?: string;
    results: { formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type: string } }[];
  };
  if (body.status === 'ZERO_RESULTS') return null;
  if (body.status !== 'OK') throw new Error(`Google geocoding: ${body.status} ${body.error_message ?? ''}`.trim());
  const hit = body.results[0];
  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    formatted: hit.formatted_address,
    source: 'google',
    precise: hit.geometry.location_type === 'ROOFTOP' || hit.geometry.location_type === 'RANGE_INTERPOLATED',
  };
}

async function viaNominatim(address: string): Promise<GeoHit | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('countrycodes', 'ph');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const r = await fetch(url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'ArtFresh-ERP-TripPlanner/1.0', 'Accept-Language': 'en' },
  });
  if (!r.ok) throw new Error(`OpenStreetMap geocoding failed (${r.status})`);
  const rows = await r.json() as { lat: string; lon: string; display_name: string; addresstype?: string; type?: string }[];
  if (!rows.length) return null;
  const hit = rows[0];
  const kind = hit.addresstype ?? hit.type ?? '';
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    formatted: hit.display_name,
    source: 'nominatim',
    precise: /^(building|house|road|street|residential|shop|amenity|commercial|retail)$/.test(kind),
  };
}

/** Looks in the cache first; only misses go to the provider. */
export async function geocode(
  companyId: string, address: string,
): Promise<{ hit: GeoHit | null; cached: boolean }> {
  const key = addressKey(address);
  if (!key) return { hit: null, cached: true };

  const [cached] = await query<{ latitude: string | null; longitude: string | null; formatted: string | null; source: GeoHit['source']; precise: boolean }>(
    `SELECT latitude, longitude, formatted, source, precise
       FROM geocode_cache WHERE company_id = $1 AND address_key = $2`,
    [companyId, key],
  );
  if (cached) {
    if (cached.latitude == null || cached.longitude == null) return { hit: null, cached: true }; // remembered miss
    return {
      hit: { lat: Number(cached.latitude), lng: Number(cached.longitude), formatted: cached.formatted, source: cached.source, precise: cached.precise },
      cached: true,
    };
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const hit = googleKey ? await viaGoogle(address, googleKey) : await viaNominatim(address);
  await remember(companyId, address, hit, hit?.source ?? (googleKey ? 'google' : 'nominatim'));
  return { hit, cached: false };
}

export async function remember(
  companyId: string, address: string, hit: Omit<GeoHit, 'source'> | null, source: GeoHit['source'],
): Promise<void> {
  // A hand-placed pin outranks any later geocoder answer for the same text.
  await query(
    `INSERT INTO geocode_cache (company_id, address_key, latitude, longitude, formatted, source, precise)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (company_id, address_key) DO UPDATE
       SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
           formatted = EXCLUDED.formatted, source = EXCLUDED.source,
           precise = EXCLUDED.precise, updated_at = now()
     WHERE geocode_cache.source <> 'manual' OR EXCLUDED.source = 'manual'`,
    [companyId, addressKey(address), hit?.lat ?? null, hit?.lng ?? null, hit?.formatted ?? null, source, hit?.precise ?? false],
  );
}

/** Nominatim's policy is one request per second; Google has no such limit. */
export const PROVIDER_DELAY_MS = process.env.GOOGLE_MAPS_API_KEY ? 0 : 1100;
