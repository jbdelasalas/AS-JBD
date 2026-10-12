'use client';

// Leaflet map for the trip planner: depot, numbered stops coloured by truck,
// and each truck's route as a line. Click-to-pin when `pinning` is set.
//
// Lines join stops in delivery order; they show the route's shape, not the
// roads driven. Tiles are OpenStreetMap — no API key.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapStop { id: string; lat: number; lng: number; label: string; title: string; color: string; rough: boolean }
export interface MapRoute { color: string; points: [number, number][] }

interface Props {
  depot: { lat: number; lng: number; name: string } | null;
  stops: MapStop[];
  routes: MapRoute[];
  pinning: string | null;               // label of what the next click will place
  onPick?: (lat: number, lng: number) => void;
  onStopClick?: (id: string) => void;
  height?: number;
}

const PH_CENTER: [number, number] = [13.9, 121.15];

function stopIcon(label: string, color: string, rough: boolean) {
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `<div style="width:24px;height:24px;border-radius:50%;background:${color};color:#fff;
      font:600 11px/24px system-ui,sans-serif;text-align:center;
      border:2px ${rough ? 'dashed #f59e0b' : 'solid #fff'};box-shadow:0 1px 3px rgba(0,0,0,.4)">${label}</div>`,
  });
}

const depotIcon = L.divIcon({
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  html: `<div style="width:28px;height:28px;border-radius:6px;background:#0f172a;color:#fff;
    font:700 13px/28px system-ui,sans-serif;text-align:center;border:2px solid #fff;
    box-shadow:0 1px 3px rgba(0,0,0,.5)">D</div>`,
});

export default function RouteMap({ depot, stops, routes, pinning, onPick, onStopClick, height = 460 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  const clickRef = useRef(onStopClick);
  const pinningRef = useRef(pinning);
  pickRef.current = onPick;
  clickRef.current = onStopClick;
  pinningRef.current = pinning;
  const fitted = useRef('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: PH_CENTER, zoom: 9 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (pinningRef.current) pickRef.current?.(e.latlng.lat, e.latlng.lng);
    });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const r of routes) {
      if (r.points.length > 1) L.polyline(r.points, { color: r.color, weight: 3, opacity: 0.8 }).addTo(g);
    }
    if (depot) L.marker([depot.lat, depot.lng], { icon: depotIcon, zIndexOffset: 1000 }).bindTooltip(depot.name).addTo(g);
    for (const s of stops) {
      L.marker([s.lat, s.lng], { icon: stopIcon(s.label, s.color, s.rough) })
        .bindTooltip(s.title)
        .on('click', () => clickRef.current?.(s.id))
        .addTo(g);
    }
    // Re-frame only when the set of places changes, not on every re-render,
    // so the view does not jump while someone is working on the map.
    const pts: [number, number][] = [
      ...(depot ? [[depot.lat, depot.lng] as [number, number]] : []),
      ...stops.map((s) => [s.lat, s.lng] as [number, number]),
    ];
    const key = pts.map((p) => p.join(',')).sort().join('|');
    if (pts.length && key !== fitted.current) {
      fitted.current = key;
      m.fitBounds(L.latLngBounds(pts).pad(0.1), { maxZoom: 14 });
    }
  }, [depot, stops, routes]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = pinning ? 'crosshair' : '';
  }, [pinning]);

  return (
    <div className="relative">
      <div ref={el} style={{ height }} className="z-0 w-full rounded-lg border border-slate-200 dark:border-slate-700" />
      {pinning && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-[1000] -translate-x-1/2 rounded bg-slate-900/90 px-3 py-1 text-xs text-white">
          Click the map to place: {pinning}
        </div>
      )}
    </div>
  );
}
