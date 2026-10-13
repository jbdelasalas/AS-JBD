// Shapes shared by the trip-planner page and the /logistics API routes.

export interface PlanItem { product: string; qty: number; uom: string; kg: number | null }

export interface PlanStop {
  id: string;                    // stable within one plan (SO no., or a generated key)
  so_ref: string;
  sales_order_id: string | null;
  customer_id: string | null;
  customer: string;
  address: string;
  lat: number | null;
  lng: number | null;
  pin: 'confirmed' | 'precise' | 'rough' | 'missing';
  kg: number;
  items: PlanItem[];
  window_from: string | null;    // "HH:MM"
  window_to: string | null;
  remarks: string;
  needs_reefer: boolean;
  small_truck_only: boolean;
  vehicle_id: string | null;     // pinned to a truck by the dispatcher
}

export interface PlanTruck {
  id: string;                    // vehicle id, or "adhoc-…" for a truck not in the master list
  vehicle_id: string | null;
  plate: string;
  capacity_kg: number;
  reefer: boolean;
  start: string;                 // "HH:MM"
  end: string;
  driver: string;
  helper: string;
}

export interface PlanOptions {
  speed_kmh: number;
  service_min: number;
  max_on_road_min: number | null;
  strict_windows: boolean;       // never plan an arrival after a client stops receiving
  small_truck_max_kg: number;
  return_to_depot: boolean;
  use_ai: boolean;
}

export interface PlanDepot { warehouse_id: string | null; name: string; lat: number; lng: number }

export interface PlanInput {
  plan_date: string;
  depot: PlanDepot;
  stops: PlanStop[];
  trucks: PlanTruck[];
  options: PlanOptions;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  speed_kmh: 25,
  service_min: 15,
  max_on_road_min: 360,
  strict_windows: true,
  small_truck_max_kg: 2000,
  return_to_depot: true,
  use_ai: true,
};
