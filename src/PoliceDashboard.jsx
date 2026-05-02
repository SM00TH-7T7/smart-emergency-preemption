import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Activity, AlertTriangle, Bell, LogOut, MapPin, RadioTower, ShieldCheck, Siren, Zap } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';
import useAlertSound from './hooks/useAlertSound';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CITY_CENTER = [78.4772, 17.4065];
const GEOFENCE_RADIUS_KM = 0.5;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function createAmbulanceMarker() {
  const m = document.createElement('div');
  m.innerHTML = `<div style="width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#ef4444;color:white;border:4px solid white;font-size:19px;font-weight:900;box-shadow:0 0 0 8px rgba(239,68,68,0.25),0 12px 32px rgba(127,29,29,0.55);">+</div>`;
  return m;
}

function createSignalMarkerEl(signal) {
  const mode = signal.preemption_mode || 'normal';
  const st = String(signal.status || 'red').toLowerCase();
  const isFailed = mode === 'failed';
  const isGreen = st === 'green';
  const color = isFailed ? '#f59e0b' : isGreen ? '#22c55e' : '#ef4444';
  const glow = isFailed ? 'rgba(245,158,11,0.35)' : isGreen ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;';

  const badge = document.createElement('div');
  badge.style.cssText = `background:${color};color:white;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;box-shadow:0 0 8px ${glow};white-space:nowrap;`;
  badge.textContent = `${signal.queue_length ?? 0} cars`;

  const dot = document.createElement('div');
  dot.style.cssText = `width:26px;height:26px;border-radius:50%;border:3px solid white;background:${color};box-shadow:0 0 14px ${glow};display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:900;cursor:pointer;`;
  dot.textContent = signal.name?.match(/\d+/)?.[0] ? `S${signal.name.match(/\d+/)[0]}` : 'S';

  wrapper.appendChild(badge);
  wrapper.appendChild(dot);
  return wrapper;
}

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
  const prevEventCountRef = useRef(0);
  const hasFittedRef = useRef(false);

  const [missionSignals, setMissionSignals] = useState([]);
  const [preemptionEvents, setPreemptionEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [ambulanceCount, setAmbulanceCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  // Init map
  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErrorMessage('Missing VITE_MAPBOX_TOKEN.'); return undefined; }
    if (!mapContainerRef.current || mapRef.current) return undefined;
    const map = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11', center: CITY_CENTER, zoom: 12 });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    mapRef.current = map;
    return () => {
      ambulanceMarkersRef.current.forEach((m) => m.remove());
      signalMarkersRef.current.forEach((m) => m.remove());
      ambulanceMarkersRef.current.clear(); signalMarkersRef.current.clear();
      map.remove(); mapRef.current = null;
    };
  }, []);

  // Draw geofence circle
  const drawGeofence = (signal) => {
    if (!mapRef.current || !signal?.id) return;
    const sourceId = `gf-${signal.id}`;
    const circle = createGeofenceCircle([signal.lng, signal.lat], GEOFENCE_RADIUS_KM);
    const add = () => {
      if (!mapRef.current) return;
      if (mapRef.current.getSource(sourceId)) { mapRef.current.getSource(sourceId).setData(circle); return; }
      mapRef.current.addSource(sourceId, { type: 'geojson', data: circle });
      mapRef.current.addLayer({ id: `${sourceId}-fill`, type: 'fill', source: sourceId, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.07 } });
      mapRef.current.addLayer({ id: `${sourceId}-line`, type: 'line', source: sourceId, paint: { 'line-color': '#f59e0b', 'line-opacity': 0.3, 'line-width': 2, 'line-dasharray': [4, 4] } });
    };
    mapRef.current.loaded() ? add() : mapRef.current.once('load', add);
  };

  // Render signal marker on map
  const upsertSignalMarker = (signal) => {
    if (!mapRef.current || !signal?.id) return;
    const key = signal.id;
    const existing = signalMarkersRef.current.get(key);
    if (existing) existing.remove();
    const el = createSignalMarkerEl(signal);
    const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([signal.lng, signal.lat]).addTo(mapRef.current);
    signalMarkersRef.current.set(key, m);
    drawGeofence(signal);
  };

  // Ambulance markers
  const upsertAmbulanceMarker = (loc) => {
    if (!mapRef.current || !loc?.driver_id || loc.lat == null) return;
    const ll = [loc.lng, loc.lat];
    const existing = ambulanceMarkersRef.current.get(loc.driver_id);
    if (existing) { existing.setLngLat(ll); return; }
    const m = new mapboxgl.Marker({ element: createAmbulanceMarker(), anchor: 'center' }).setLngLat(ll).addTo(mapRef.current);
    ambulanceMarkersRef.current.set(loc.driver_id, m);
    setAmbulanceCount(ambulanceMarkersRef.current.size);
  };

  // Override signal to green
  const overrideSignal = async (signal) => {
    if (!signal?.id) return;
    const ts = new Date().toISOString();
    const { error } = await supabase.from('traffic_signals').update({ status: 'green', preemption_mode: 'manual_override', last_preempted_at: ts, updated_at: ts }).eq('id', signal.id);
    if (error) { setErrorMessage(error.message); return; }
    playAlert('success');
    // Also insert a preemption event
    if (signal.active_mission_id) {
      await supabase.from('preemption_events').insert({ mission_id: signal.active_mission_id, traffic_signal_id: signal.id, trigger_distance_meters: 0, requested_by: 'police', result: 'manual_override' });
    }
    addNotification('success', `Override sent: ${signal.name} → GREEN`);
  };

  // Notification system
  const addNotification = (type, message) => {
    const id = Date.now();
    setNotifications(prev => [{ id, type, message }, ...prev].slice(0, 5));
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 6000);
  };

  // ── ONLY fetch signals with active_mission_id (on an active ambulance route) ──
  useEffect(() => {
    let mounted = true;
    async function fetchMissionSignals() {
      const { data } = await supabase.from('traffic_signals')
        .select('id, osm_ref, name, lat, lng, status, queue_length, preemption_mode, active_mission_id, updated_at')
        .not('active_mission_id', 'is', null)
        .order('updated_at', { ascending: false });
      if (!mounted) return;
      const signals = data || [];
      setMissionSignals(signals);
      signals.forEach(s => upsertSignalMarker(s));

      // Auto-fit map to signals + ambulances on first load
      if (signals.length > 0 && mapRef.current && !hasFittedRef.current) {
        hasFittedRef.current = true;
        const bounds = new mapboxgl.LngLatBounds();
        signals.forEach(s => bounds.extend([s.lng, s.lat]));
        ambulanceMarkersRef.current.forEach(m => bounds.extend(m.getLngLat()));
        mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15 });
      }
    }
    fetchMissionSignals();

    // Live updates — only for signals with active missions
    const ch = supabase.channel('police-mission-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'traffic_signals' }, (p) => {
        const signal = p.new;
        if (!signal?.active_mission_id) return; // ignore signals not on a mission
        fetchMissionSignals();
        // Notification on state change
        if (signal.preemption_mode === 'failed') {
          addNotification('danger', `⚠ AI FAILED at ${signal.name} — Override needed!`);
          playAlert('alert');
        } else if (signal.preemption_mode === 'ai_active') {
          addNotification('info', `AI preemption active: ${signal.name} → GREEN`);
        } else if (signal.preemption_mode === 'manual_override') {
          addNotification('success', `Police override: ${signal.name} → GREEN`);
        }
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Track ambulance positions
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('driver_locations').select('driver_id, lat, lng');
      if (mounted) data?.forEach(upsertAmbulanceMarker);
    }
    f();
    const ch = supabase.channel('police-driver-locs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations' }, (p) => {
        if (p.new) upsertAmbulanceMarker(p.new);
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  // Fetch preemption events (only mission-related)
  useEffect(() => {
    let mounted = true;
    async function f() {
      const { data } = await supabase.from('preemption_events')
        .select('id, mission_id, traffic_signal_id, trigger_distance_meters, requested_by, result, created_at, traffic_signals(name)')
        .order('created_at', { ascending: false }).limit(8);
      if (mounted) setPreemptionEvents(data || []);
    }
    f();
    const ch = supabase.channel('police-preemption')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'preemption_events' }, f)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []);

  const failedSignals = missionSignals.filter(s => s.preemption_mode === 'failed');
  const activeSignals = missionSignals.filter(s => s.preemption_mode === 'ai_active' || s.preemption_mode === 'manual_override');

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {/* Top bar */}
      <div className="absolute left-4 right-4 top-4 z-20 flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Police Command</p>
          <h1 className="mt-1 text-lg font-black text-white">Emergency Traffic Monitor</h1>
          <p className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Activity className="h-3.5 w-3.5 text-cyan-300" />
            {missionSignals.length} signal{missionSignals.length !== 1 ? 's' : ''} on active routes • {ambulanceCount} ambulance{ambulanceCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button type="button" onClick={signOut} aria-label="Sign out"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur active:scale-95">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      {/* Notification toasts — top right */}
      <div className="absolute right-4 top-20 z-30 flex w-80 flex-col gap-2">
        {notifications.map((n) => (
          <div key={n.id}
            className={`flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold shadow-2xl backdrop-blur slide-in ${
              n.type === 'danger' ? 'border-red-400/40 bg-red-950/95 text-red-100'
              : n.type === 'success' ? 'border-emerald-400/40 bg-emerald-950/95 text-emerald-100'
              : 'border-blue-400/40 bg-blue-950/95 text-blue-100'}`}>
            {n.type === 'danger' ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
              : n.type === 'success' ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              : <Bell className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />}
            <p>{n.message}</p>
          </div>
        ))}
      </div>

      {/* FAILED signal override buttons — persistent floating */}
      {failedSignals.length > 0 && (
        <div className="absolute left-4 top-[110px] z-30 flex flex-col gap-2 w-72">
          {failedSignals.map((s) => (
            <button key={s.id} type="button" onClick={() => overrideSignal(s)}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black text-white shadow-2xl siren-flash override-glow fade-in"
              style={{ background: '#dc2626' }}>
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <div>
                <p className="text-[10px] font-bold uppercase opacity-80">AI Failed — {s.name}</p>
                <p className="text-sm">OVERRIDE TO GREEN</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Bottom panel */}
      <section className="absolute bottom-0 left-0 right-0 z-20 max-h-[65vh] overflow-y-auto custom-scrollbar rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">

          {/* Signal status panel */}
          {missionSignals.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400 mb-3">Signals on Active Routes</p>
              <div className="grid gap-2">
                {missionSignals.map((s) => {
                  const isGreen = s.status === 'green';
                  const isFailed = s.preemption_mode === 'failed';
                  const isOverride = s.preemption_mode === 'manual_override';
                  return (
                    <div key={s.id} className={`flex items-center justify-between rounded-xl border p-3 text-sm font-semibold slide-in ${
                      isFailed ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                      : isGreen ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : 'border-red-400/20 bg-red-400/10 text-red-100'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`h-3.5 w-3.5 rounded-full ${isFailed ? 'bg-amber-400 siren-flash' : isGreen ? 'bg-emerald-400 live-dot' : 'bg-red-400'}`} />
                        <div>
                          <p className="text-sm font-bold">{s.name}</p>
                          <p className="text-xs opacity-60">{s.queue_length} vehicles queued</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
                          isFailed ? 'bg-amber-500 text-white' : isOverride ? 'bg-blue-500 text-white' : isGreen ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                          {isFailed ? 'AI FAILED' : isOverride ? 'OVERRIDE' : isGreen ? 'GREEN' : 'RED'}
                        </span>
                        {isFailed && (
                          <button type="button" onClick={() => overrideSignal(s)}
                            className="rounded-lg bg-red-600 px-2.5 py-1 text-[10px] font-black uppercase text-white hover:bg-red-500 active:scale-95">
                            FIX
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm font-semibold text-slate-400">
              <RadioTower className="h-5 w-5 shrink-0 text-cyan-300" />
              <div>
                <p className="text-white">No active ambulance corridors</p>
                <p className="mt-1 text-xs">Signals will appear here when an ambulance is dispatched and approaches traffic intersections.</p>
              </div>
            </div>
          )}

          {/* Preemption event log */}
          {preemptionEvents.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400 mb-3">Preemption Event Log</p>
              <div className="grid gap-2">
                {preemptionEvents.slice(0, 5).map((ev, i) => {
                  const fail = ev.result === 'failed';
                  const manual = ev.result === 'manual_override';
                  return (
                    <div key={ev.id} style={{ animationDelay: `${i * 60}ms` }}
                      className={`flex items-start gap-3 rounded-xl border p-2.5 text-sm font-semibold slide-in ${
                        fail ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                        : manual ? 'border-blue-400/30 bg-blue-400/10 text-blue-100'
                        : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'}`}>
                      {fail ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Zap className="mt-0.5 h-4 w-4 shrink-0" />}
                      <div>
                        <p className="text-xs">{fail ? 'AI failed — override needed' : manual ? 'Police override sent' : 'AI preemption cleared'}</p>
                        <p className="mt-0.5 text-[11px] opacity-60">{ev.traffic_signals?.name || 'Signal'} at {ev.trigger_distance_meters}m</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100">{errorMessage}</div>
          )}

          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            500m geofence zones active • Real-time Supabase sync
          </div>
        </div>
      </section>
    </main>
  );
}
