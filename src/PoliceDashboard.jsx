import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Activity, AlertTriangle, LogOut, RadioTower, ShieldCheck, Siren, Zap } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';
import useAlertSound from './hooks/useAlertSound';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CITY_CENTER = [78.4772, 17.4065];
const GEOFENCE_RADIUS_KM = 0.5; // 500 meters
const ROUTE_LOOK_BEHIND = 12;
const ROUTE_LOOK_AHEAD = 30;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function normalizeStatus(s) { return String(s || 'red').toLowerCase() === 'green' ? 'green' : 'red'; }

function createAmbulanceMarker() {
  const m = document.createElement('div');
  m.innerHTML = `<div style="width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#ef4444;color:white;border:4px solid white;font-size:19px;font-weight:900;box-shadow:0 0 0 8px rgba(239,68,68,0.25),0 12px 32px rgba(127,29,29,0.55);">+</div>`;
  return m;
}

function createSignalMarker(signal) {
  const st = normalizeStatus(signal.status);
  const mode = signal.preemption_mode || 'normal';
  const color = mode === 'failed' ? '#f59e0b' : st === 'green' ? '#22c55e' : '#ef4444';
  const m = document.createElement('button');
  m.type = 'button'; m.setAttribute('aria-label', `${signal.name} traffic signal`);
  Object.assign(m.style, { width: '30px', height: '30px', borderRadius: '9999px', border: '4px solid white', background: color, cursor: 'pointer', padding: '0',
    boxShadow: `0 0 0 7px ${mode === 'failed' ? 'rgba(245,158,11,0.28)' : st === 'green' ? 'rgba(34,197,94,0.22)' : 'rgba(239,68,68,0.22)'}, 0 12px 28px rgba(15,23,42,0.35)` });
  return m;
}

function isRealSignal(s) { return Boolean(s?.osm_ref); }

function findClosestCoordIdx(coords, loc) {
  if (!coords?.length || !loc) return -1;
  return coords.reduce((b, c, i) => {
    const km = distance(point(c), point([loc.lng, loc.lat]), { units: 'kilometers' });
    return km < b.km ? { index: i, km } : b;
  }, { index: -1, km: Infinity }).index;
}

function formatPreemptionMode(mode) {
  if (mode === 'ai_active') return 'AI ACTIVE';
  if (mode === 'manual_override') return 'MANUAL OVERRIDE';
  if (mode === 'failed') return 'AI FAILED';
  return 'NORMAL';
}

function createSignalPopup(signal, onQueueChange, onOverride) {
  const st = normalizeStatus(signal.status);
  const mode = signal.preemption_mode || 'normal';
  const w = document.createElement('div');
  w.style.width = '240px'; w.style.color = '#0f172a';
  w.innerHTML = `
    <div style="font-family:system-ui,-apple-system,sans-serif;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;">Intersection</p>
      <h3 style="margin:0;font-size:17px;line-height:1.2;color:#0f172a;">${signal.name}</h3>
      <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="font-size:13px;font-weight:700;color:#334155;">Status</span>
        <span style="border-radius:9999px;padding:4px 9px;font-size:12px;font-weight:900;color:white;background:${st === 'green' ? '#16a34a' : '#dc2626'};">${st.toUpperCase()}</span>
      </div>
      <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span style="font-size:13px;font-weight:700;color:#334155;">Preemption</span>
        <span style="border-radius:9999px;padding:4px 9px;font-size:12px;font-weight:900;color:white;background:${mode === 'failed' ? '#d97706' : mode === 'normal' ? '#475569' : '#2563eb'};">${formatPreemptionMode(mode)}</span>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b;">OSM ${signal.osm_ref}</p>
      <label for="sq-${signal.id}" style="display:block;margin-top:14px;font-size:13px;font-weight:800;color:#334155;">Traffic Queue</label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px;">
        <input id="sq-${signal.id}" type="range" min="0" max="50" value="${signal.queue_length ?? 0}" style="width:100%;" />
        <strong id="sqv-${signal.id}" style="min-width:28px;text-align:right;color:#0f172a;">${signal.queue_length ?? 0}</strong>
      </div>
      <button id="so-${signal.id}" type="button" style="margin-top:14px;width:100%;min-height:42px;border:0;border-radius:14px;background:#dc2626;color:white;font-size:13px;font-weight:900;cursor:pointer;">OVERRIDE TO GREEN</button>
    </div>`;
  const slider = w.querySelector(`#sq-${CSS.escape(signal.id)}`);
  const valLabel = w.querySelector(`#sqv-${CSS.escape(signal.id)}`);
  const btn = w.querySelector(`#so-${CSS.escape(signal.id)}`);
  slider.addEventListener('input', (e) => { valLabel.textContent = e.target.value; });
  slider.addEventListener('change', (e) => { onQueueChange(signal.id, Number(e.target.value)); });
  btn.addEventListener('click', () => { onOverride(signal); });
  return w;
}

// Generate a GeoJSON circle polygon for a geofence
function createGeofenceCircle(center, radiusKm, steps = 64) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 360;
    const rad = (angle * Math.PI) / 180;
    const dx = radiusKm / (111.32 * Math.cos((center[1] * Math.PI) / 180));
    const dy = radiusKm / 110.574;
    coords.push([center[0] + dx * Math.cos(rad), center[1] + dy * Math.sin(rad)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

export default function PoliceDashboard() {
  const { signOut } = useAuth();
  const { playAlert } = useAlertSound();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const ambulanceMarkersRef = useRef(new Map());
  const signalMarkersRef = useRef(new Map());
  const signalPopupsRef = useRef(new Map());
  const driverLocRef = useRef(new Map());
  const missionsRef = useRef(new Map());
  const geofenceSourcesRef = useRef(new Set());
  const prevFailCountRef = useRef(0);

  const [ambulanceCount, setAmbulanceCount] = useState(0);
  const [signalCount, setSignalCount] = useState(0);
  const [routeCount, setRouteCount] = useState(0);
  const [preemptionEvents, setPreemptionEvents] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  // Init map
  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErrorMessage('Missing VITE_MAPBOX_TOKEN.'); return undefined; }
    if (!mapContainerRef.current || mapRef.current) return undefined;
    const map = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: CITY_CENTER, zoom: 11.5 });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    mapRef.current = map;
    return () => {
      ambulanceMarkersRef.current.forEach((m) => m.remove());
      signalMarkersRef.current.forEach((m) => m.remove());
      signalPopupsRef.current.forEach((p) => p.remove());
      ambulanceMarkersRef.current.clear(); signalMarkersRef.current.clear(); signalPopupsRef.current.clear();
      driverLocRef.current.clear(); missionsRef.current.clear();
      map.remove(); mapRef.current = null;
    };
  }, []);

  // Draw geofence circle on map for a signal
  const drawGeofence = (signal) => {
    if (!mapRef.current || !signal?.id) return;
    const sourceId = `geofence-${signal.id}`;
    const layerFill = `${sourceId}-fill`;
    const layerLine = `${sourceId}-line`;

    const circle = createGeofenceCircle([signal.lng, signal.lat], GEOFENCE_RADIUS_KM);

    const addLayers = () => {
      if (!mapRef.current) return;
      if (mapRef.current.getSource(sourceId)) {
        mapRef.current.getSource(sourceId).setData(circle);
        return;
      }
      mapRef.current.addSource(sourceId, { type: 'geojson', data: circle });
      mapRef.current.addLayer({ id: layerFill, type: 'fill', source: sourceId, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.06 } });
      mapRef.current.addLayer({ id: layerLine, type: 'line', source: sourceId, paint: { 'line-color': '#f59e0b', 'line-opacity': 0.25, 'line-width': 1.5, 'line-dasharray': [4, 4] } });
      geofenceSourcesRef.current.add(sourceId);
    };

    if (mapRef.current.loaded()) addLayers();
    else mapRef.current.once('load', addLayers);
  };

  const upsertNearbyRoute = (mission) => {
    if (!mapRef.current || !mission?.id || !mission?.driver_id || !Array.isArray(mission.route_coordinates)) return;
    if (!mapRef.current.loaded()) { mapRef.current.once('load', () => upsertNearbyRoute(mission)); return; }
    const dLoc = driverLocRef.current.get(mission.driver_id);
    if (!dLoc) return;
    const idx = findClosestCoordIdx(mission.route_coordinates, dLoc);
    if (idx < 0) return;
    const seg = mission.route_coordinates.slice(Math.max(0, idx - ROUTE_LOOK_BEHIND), Math.min(mission.route_coordinates.length, idx + ROUTE_LOOK_AHEAD));
    if (seg.length < 2) return;
    const sid = `police-route-${mission.id}`, lid = `${sid}-line`;
    const geo = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: seg } };
    if (mapRef.current.getSource(sid)) { mapRef.current.getSource(sid).setData(geo); }
    else {
      mapRef.current.addSource(sid, { type: 'geojson', data: geo });
      mapRef.current.addLayer({ id: lid, type: 'line', source: sid, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f97316', 'line-opacity': 0.92, 'line-width': 7 } });
    }
  };

  const removeNearbyRoute = (missionId) => {
    if (!mapRef.current || !missionId || !mapRef.current.loaded()) return;
    const sid = `police-route-${missionId}`, lid = `${sid}-line`;
    if (mapRef.current.getLayer(lid)) mapRef.current.removeLayer(lid);
    if (mapRef.current.getSource(sid)) mapRef.current.removeSource(sid);
  };

  const refreshRoutes = () => {
    missionsRef.current.forEach((m) => upsertNearbyRoute(m));
    setRouteCount(missionsRef.current.size);
  };

  const upsertAmbulanceMarker = (loc) => {
    if (!mapRef.current || !loc?.driver_id || loc.lat == null) return;
    const ll = [loc.lng, loc.lat];
    driverLocRef.current.set(loc.driver_id, { lat: loc.lat, lng: loc.lng });
    const existing = ambulanceMarkersRef.current.get(loc.driver_id);
    if (existing) { existing.setLngLat(ll); refreshRoutes(); return; }
    const m = new mapboxgl.Marker({ element: createAmbulanceMarker(), anchor: 'center' }).setLngLat(ll).addTo(mapRef.current);
    ambulanceMarkersRef.current.set(loc.driver_id, m);
    setAmbulanceCount(ambulanceMarkersRef.current.size);
    refreshRoutes();
  };

  const removeAmbulanceMarker = (driverId) => {
    const m = ambulanceMarkersRef.current.get(driverId);
    if (m) { m.remove(); ambulanceMarkersRef.current.delete(driverId); driverLocRef.current.delete(driverId); setAmbulanceCount(ambulanceMarkersRef.current.size); }
  };

  const updateQueue = async (signalId, q) => {
    const { error } = await supabase.from('traffic_signals').update({ queue_length: Math.max(0, Math.min(50, q)), updated_at: new Date().toISOString() }).eq('id', signalId);
    if (error) setErrorMessage(error.message);
  };

  const overrideSignal = async ({ signalId, missionId }) => {
    if (!signalId) return;
    const ts = new Date().toISOString();
    const { error } = await supabase.from('traffic_signals').update({ status: 'green', preemption_mode: 'manual_override', last_preempted_at: ts, updated_at: ts }).eq('id', signalId);
    if (error) { setErrorMessage(error.message); return; }
    playAlert('success');
    if (missionId) {
      await supabase.from('preemption_events').insert({ mission_id: missionId, traffic_signal_id: signalId, trigger_distance_meters: 0, requested_by: 'police', result: 'manual_override' });
    }
  };

  const handleOverride = async (signal) => {
    await overrideSignal({ signalId: signal?.id, missionId: signal?.active_mission_id });
  };

  const upsertSignalMarker = (signal) => {
    if (!mapRef.current || !signal?.id || signal.lat == null) return;
    if (!isRealSignal(signal)) { removeSignalMarker(signal.id); return; }
    const existing = signalMarkersRef.current.get(signal.id);
    if (existing) existing.remove();
    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 18 }).setDOMContent(createSignalPopup(signal, updateQueue, handleOverride));
    const m = new mapboxgl.Marker({ element: createSignalMarker(signal), anchor: 'center' }).setLngLat([signal.lng, signal.lat]).setPopup(popup).addTo(mapRef.current);
    signalMarkersRef.current.set(signal.id, m);
    signalPopupsRef.current.set(signal.id, popup);
    setSignalCount(signalMarkersRef.current.size);
    // Draw geofence circle
    drawGeofence(signal);
  };

  const removeSignalMarker = (id) => {
    const m = signalMarkersRef.current.get(id);
    const p = signalPopupsRef.current.get(id);
    if (m) m.remove(); if (p) p.remove();
    signalMarkersRef.current.delete(id); signalPopupsRef.current.delete(id);
    setSignalCount(signalMarkersRef.current.size);
  };

  // Fetch ambulances
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('driver_locations').select('driver_id, lat, lng, updated_at');
      if (mounted) data?.forEach(upsertAmbulanceMarker);
    }
    f();
    const ch = supabase.channel('police-driver-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (p) => {
        if (p.eventType === 'DELETE') { removeAmbulanceMarker(p.old?.driver_id); return; }
        upsertAmbulanceMarker(p.new);
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Fetch active missions
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('active_missions').select('id, driver_id, status, route_coordinates, route_pickup_index, updated_at').in('status', ['accepted', 'en_route_hospital']);
      if (!mounted) return;
      missionsRef.current.clear();
      data?.forEach((m) => { if (m.driver_id && Array.isArray(m.route_coordinates)) missionsRef.current.set(m.id, m); });
      refreshRoutes();
    }
    f();
    const ch = supabase.channel('police-missions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_missions' }, async (p) => {
        const mission = p.new;
        if (!mission || !['accepted', 'en_route_hospital'].includes(mission.status)) {
          if (p.old?.id) { missionsRef.current.delete(p.old.id); removeNearbyRoute(p.old.id); }
          refreshRoutes(); return;
        }
        const { data } = await supabase.from('active_missions').select('id, driver_id, status, route_coordinates, route_pickup_index, updated_at').eq('id', mission.id).maybeSingle();
        if (data?.driver_id && Array.isArray(data.route_coordinates)) missionsRef.current.set(data.id, data);
        refreshRoutes();
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Fetch signals
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('traffic_signals')
        .select('id, osm_ref, name, lat, lng, status, queue_length, preemption_mode, active_mission_id, last_preempted_at, updated_at')
        .not('osm_ref', 'is', null).order('name', { ascending: true });
      if (mounted) data?.forEach(upsertSignalMarker);
    }
    f();
    const ch = supabase.channel('police-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traffic_signals' }, (p) => {
        if (p.eventType === 'DELETE') { removeSignalMarker(p.old?.id); return; }
        if (!isRealSignal(p.new)) { removeSignalMarker(p.new?.id); return; }
        upsertSignalMarker(p.new);
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Fetch preemption events
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('preemption_events')
        .select('id, mission_id, traffic_signal_id, trigger_distance_meters, requested_by, result, created_at, traffic_signals(name)')
        .order('created_at', { ascending: false }).limit(6);
      if (mounted) setPreemptionEvents(data || []);
    }
    f();
    const ch = supabase.channel('police-preemption')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'preemption_events' }, f)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Play siren when new AI failure events come in
  useEffect(() => {
    const failCount = preemptionEvents.filter((e) => e.result === 'failed').length;
    if (failCount > prevFailCountRef.current) playAlert('alert');
    prevFailCountRef.current = failCount;
  }, [preemptionEvents, playAlert]);

  const latestPre = preemptionEvents[0];
  const latestFailed = preemptionEvents.find((e) => e.result === 'failed');
  const failedCount = preemptionEvents.filter((e) => e.result === 'failed').length;

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {/* Top bar */}
      <div className="absolute left-4 right-4 top-4 z-20 flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Police Command</p>
          <h1 className="mt-1 text-xl font-black text-white">City Emergency Monitor</h1>
        </div>
        <button type="button" onClick={signOut} aria-label="Sign out"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur active:scale-95">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      {/* Persistent OVERRIDE FAB — appears when any signal has failed AI */}
      {latestFailed && (
        <button type="button"
          onClick={() => overrideSignal({ signalId: latestFailed.traffic_signal_id, missionId: latestFailed.mission_id })}
          className="absolute right-4 top-20 z-30 flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-black uppercase tracking-wide text-white shadow-2xl siren-flash override-glow fade-in"
          style={{ background: '#dc2626' }}>
          <AlertTriangle className="h-6 w-6" />
          <div className="text-left">
            <p className="text-xs font-bold opacity-80">AI Failed — {latestFailed.traffic_signals?.name}</p>
            <p className="text-base">OVERRIDE TO GREEN</p>
          </div>
        </button>
      )}

      {/* Bottom panel */}
      <section className="absolute bottom-0 left-0 right-0 z-20 rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-200">Ambulances</p>
                <Siren className="h-5 w-5 text-red-300" />
              </div>
              <p className="mt-2 text-3xl font-black text-white">{ambulanceCount}</p>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">Signals</p>
                <Activity className="h-5 w-5 text-cyan-300" />
              </div>
              <p className="mt-2 text-3xl font-black text-white">{signalCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">Failsafe</p>
                <AlertTriangle className="h-5 w-5 text-amber-300" />
              </div>
              <p className="mt-2 text-3xl font-black text-white">{failedCount}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-sm font-semibold text-slate-300">
            <RadioTower className="h-5 w-5 shrink-0 text-cyan-300" />
            <span>{routeCount} active ambulance corridor{routeCount === 1 ? '' : 's'} • 500m geofence zones active</span>
          </div>

          {latestPre && (
            <div className={`mt-3 flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold slide-in ${
              latestPre.result === 'failed' ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                : latestPre.result === 'manual_override' ? 'border-blue-400/30 bg-blue-500/10 text-blue-100'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'}`}>
              <Zap className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p>{latestPre.result === 'failed' ? 'AI preemption failed' : latestPre.result === 'manual_override' ? 'Police override sent' : 'AI preemption active'}</p>
                <p className="mt-1 text-xs opacity-80">{latestPre.traffic_signals?.name || 'Signal'} — {latestPre.trigger_distance_meters} m</p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100 slide-in">{errorMessage}</div>
          )}

          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            Signal-controller simulation via Supabase Realtime. Geofence: 500m radius.
          </div>
        </div>
      </section>
    </main>
  );
}
