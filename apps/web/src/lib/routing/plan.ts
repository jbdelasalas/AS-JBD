// Translates a planner input into solver terms. Used by the optimize and
// confirm routes and by the page when it re-checks a hand-edited plan, so all
// three judge a plan by the same rules.

import { hhmmToMin, type Stop, type Truck, type SolveOptions, type Unassigned } from './solver';
import type { PlanInput } from './types';

export function toSolver(input: PlanInput): {
  depot: { lat: number; lng: number };
  stops: Stop[];
  trucks: Truck[];
  options: Partial<SolveOptions>;
  noLocation: Unassigned[];
} {
  const o = input.options;
  const noLocation: Unassigned[] = [];
  const stops: Stop[] = [];
  for (const s of input.stops) {
    if (s.lat == null || s.lng == null) {
      noLocation.push({ stopId: s.id, reason: 'no map location — set the pin' });
      continue;
    }
    stops.push({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      kg: Math.max(0, Number(s.kg) || 0),
      serviceMin: o.service_min,
      windowFrom: hhmmToMin(s.window_from),
      windowTo: hhmmToMin(s.window_to),
      needsReefer: s.needs_reefer,
      maxTruckKg: s.small_truck_only ? o.small_truck_max_kg : null,
      vehicleId: s.vehicle_id,
    });
  }
  const trucks: Truck[] = input.trucks.map((t) => ({
    id: t.id,
    capacityKg: Math.max(0, Number(t.capacity_kg) || 0),
    reefer: t.reefer,
    startMin: hhmmToMin(t.start) ?? 300,
    endMin: hhmmToMin(t.end) ?? 1140,
  }));
  return {
    depot: { lat: input.depot.lat, lng: input.depot.lng },
    stops,
    trucks,
    options: {
      speedKmh: o.speed_kmh > 0 ? o.speed_kmh : 25,
      maxOnRoadMin: o.max_on_road_min && o.max_on_road_min > 0 ? o.max_on_road_min : null,
      returnToDepot: o.return_to_depot,
    },
    noLocation,
  };
}
