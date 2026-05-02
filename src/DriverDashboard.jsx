import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Building2, Crosshair, Loader2, LogOut, MapPin, Navigation, Radio, ShieldCheck, Siren, Truck } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';
import useAlertSound from './hooks/useAlertSound';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TEST_DRIVER_LOCATION = { lat: 17.4432, lng: 78.4986 };
const SIGNAL_GEOFENCE_METERS = 500;
const MAX_PATIENT_LEG_POINTS = 45;
const MAX_HOSPITAL_LEG_POINTS = 75;
const SIMULATION_TICK_MS = 350;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function createDriverMarker() {
  const m = document.createElement('div');
  m.innerHTML = `<div style="width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#2563eb;color:white;border:4px solid white;font-size:18px;font-weight:900;box-shadow:0 0 0 8px rgba(37,99,235,0.25),0 12px 32px rgba(30,64,175,0.5);">+</div>`;
  return m;
}

function createPickupMarker() {
  const m = document.createElement('div');
  m.innerHTML = `<div style="width:24px;height:24px;border-radius:9999px;background:#ef4444;border:4px solid white;box-shadow:0 0 0 8px rgba(239,68,68,0.22),0 12px 28px rgba(127,29,29,0.45);"></div>`;
  return m;
}

function createHospitalMarker() {
  const m = document.createElement('div');
  m.innerHTML = `<div style="width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#22c55e;color:white;border:4px solid white;font-size:19px;font-weight:900;box-shadow:0 0 0 8px rgba(34,197,94,0.22),0 12px 28px rgba(20,83,45,0.45);">H</div>`;
  return m;
}

function formatDistanceKm(driverLocation, mission) {
  if (!driverLocation || !mission) return 'nearby';
  const km = distance(point([driverLocation.lng, driverLocation.lat]), point([mission.pickup_lng, mission.pickup_lat]), { units: 'kilometers' });
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
}

function findClosestCoordinateIndex(coordinates, target) {
  if (!coordinates.length || !target) return 0;
  return coordinates.reduce((best, c, i) => {
    const km = distance(point(c), point([target.lng, target.lat]), { units: 'kilometers' });
    return km < best.km ? { index: i, km } : best;
  }, { index: 0, km: Infinity }).index;
}

function sampleCoordinateRange(coords, start, end, max) {
  const s = Math.max(0, start);
  const e = Math.min(coords.length - 1, end);
  const span = coords.slice(s, e + 1);
  if (span.length <= max) return span;
  const sampled = [];
  const step = (span.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) sampled.push(span[Math.round(i * step)]);
  return sampled;
}

function buildSimulationRoute(coords, pickupIdx) {
  const patientLeg = sampleCoordinateRange(coords, 0, pickupIdx, MAX_PATIENT_LEG_POINTS);
  const hospitalLeg = sampleCoordinateRange(coords, pickupIdx, coords.length - 1, MAX_HOSPITAL_LEG_POINTS);
  return { coordinates: [...patientLeg, ...hospitalLeg.slice(1)], pickupIndex: patientLeg.length - 1 };
}

function normalizeMission(m) {
  if (!m) return null;
  return { ...m, hospital: m.hospitals || m.hospital || null };
}

export default function DriverDashboard() {
  const { signOut, user } = useAuth();
  const { playAlert } = useAlertSound();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const pickupMarkerRef = useRef(null);
  const hospitalMarkerRef = useRef(null);
  const simulationTimerRef = useRef(null);
  const triggeredSignalsRef = useRef(new Set());

  const [driverLocation, setDriverLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('Locating ambulance...');
  const [pendingMission, setPendingMission] = useState(null);
  const [activeMission, setActiveMission] = useState(null);
  const [routeProgress, setRouteProgress] = useState(0);
  const [routePhase, setRoutePhase] = useState('standby');
  const [preemptionLog, setPreemptionLog] = useState([]);
  const [isAccepting, setIsAccepting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [autoAssigned, setAutoAssigned] = useState(false);
  const initialLocationRef = useRef(null);

  const applyDriverLocation = (loc, status = 'Ambulance online') => {
    setDriverLocation(loc); setLocationStatus(status); setErrorMessage('');
    // Store the first location for map init
    if (!initialLocationRef.current) initialLocationRef.current = loc;
  };

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErrorMessage('Missing VITE_MAPBOX_TOKEN.'); return; }
    if (!navigator.geolocation) { setLocationStatus('Location unavailable'); setErrorMessage('Geolocation not available.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => applyDriverLocation({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { setLocationStatus('Location permission needed'); setErrorMessage('Location permission required.'); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }, []);

  // Init map — runs ONCE when initial location is available, never re-runs
  useEffect(() => {
    if (!initialLocationRef.current || !mapContainerRef.current || mapRef.current) return undefined;
    const loc = initialLocationRef.current;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current, style: 'mapbox://styles/mapbox/dark-v11',
      center: [loc.lng, loc.lat], zoom: 14,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    driverMarkerRef.current = new mapboxgl.Marker({ element: createDriverMarker(), anchor: 'center' })
      .setLngLat([loc.lng, loc.lat]).addTo(map);
    mapRef.current = map;
    return () => {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
      driverMarkerRef.current?.remove(); pickupMarkerRef.current?.remove(); hospitalMarkerRef.current?.remove();
      map.remove(); mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverLocation]); // triggers on first driverLocation set, guard prevents re-init

  // Sync driver marker position (runs on every driverLocation change during simulation)
  useEffect(() => {
    if (!driverLocation || !mapRef.current || !driverMarkerRef.current) return;
    driverMarkerRef.current.setLngLat([driverLocation.lng, driverLocation.lat]);
    if (!activeMission) mapRef.current.easeTo({ center: [driverLocation.lng, driverLocation.lat], duration: 500, zoom: 14 });
  }, [activeMission, driverLocation]);

  // Listen for missions (both pending + auto-assigned to this driver)
  useEffect(() => {
    let mounted = true;
    async function fetchMission() {
      // Check for auto-assigned missions first
      if (user?.id) {
        const { data: assigned } = await supabase.from('active_missions')
          .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
          .eq('driver_id', user.id).eq('status', 'accepted').order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (assigned && mounted && !activeMission) {
          setAutoAssigned(true);
          setPendingMission(null);
          setActiveMission(normalizeMission(assigned));
          playAlert('siren');
          return;
        }
      }
      // Fallback: check pending missions
      const { data } = await supabase.from('active_missions')
        .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
        .eq('status', 'pending').order('updated_at', { ascending: true }).limit(1).maybeSingle();
      if (mounted && data && !activeMission) setPendingMission(normalizeMission(data));
    }
    fetchMission();
    const ch = supabase.channel('driver-missions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_missions' }, async (payload) => {
        const mission = payload.new;
        if (!mission || activeMission) return;
        // Auto-assigned to this driver
        if (mission.driver_id === user?.id && mission.status === 'accepted') {
          const { data } = await supabase.from('active_missions')
            .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
            .eq('id', mission.id).maybeSingle();
          setAutoAssigned(true);
          setPendingMission(null);
          setActiveMission(normalizeMission(data || mission));
          playAlert('siren');
          return;
        }
        if (mission.status === 'pending') {
          const { data } = await supabase.from('active_missions')
            .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
            .eq('id', mission.id).maybeSingle();
          setPendingMission(normalizeMission(data || mission));
        } else if (pendingMission?.id === mission.id && mission.status !== 'pending') {
          setPendingMission(null);
        }
      }).subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [activeMission, pendingMission?.id, user?.id, playAlert]);

  // Auto-start driving for auto-assigned missions
  useEffect(() => {
    if (autoAssigned && activeMission && driverLocation && !simulationTimerRef.current) {
      buildRouteAndStartDriving(activeMission);
      setAutoAssigned(false);
    }
  }, [autoAssigned, activeMission, driverLocation]);

  const upsertLineLayer = ({ id, coordinates, color }) => {
    if (!mapRef.current || coordinates.length < 2) return;
    const geo = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
    const sid = `${id}-source`, lid = `${id}-line`;
    if (mapRef.current.getSource(sid)) { mapRef.current.getSource(sid).setData(geo); return; }
    mapRef.current.addSource(sid, { type: 'geojson', data: geo });
    mapRef.current.addLayer({ id: lid, type: 'line', source: sid, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-opacity': 0.9, 'line-width': 6 } });
  };

  const drawRoute = (coords, pickupIdx) => {
    if (!mapRef.current || coords.length < 2) return;
    const go = () => {
      if (!mapRef.current) return;
      upsertLineLayer({ id: 'driver-route-patient', coordinates: coords.slice(0, pickupIdx + 1), color: '#2563eb' });
      upsertLineLayer({ id: 'driver-route-hospital', coordinates: coords.slice(pickupIdx), color: '#22c55e' });
      const bounds = new mapboxgl.LngLatBounds();
      coords.forEach((c) => bounds.extend(c));
      mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15 });
    };
    mapRef.current.loaded() ? go() : mapRef.current.once('load', go);
  };

  const fetchSignals = async () => {
    const { data } = await supabase.from('traffic_signals').select('id, name, lat, lng, status, queue_length, preemption_mode').not('osm_ref', 'is', null);
    return data || [];
  };

  const triggerPreemption = async (mission, signal, distMeters) => {
    if (!mission?.id || !signal?.id || triggeredSignalsRef.current.has(signal.id)) return;
    triggeredSignalsRef.current.add(signal.id);
    const n = triggeredSignalsRef.current.size;
    const aiFails = Number(signal.queue_length || 0) >= 35 || n % 4 === 0;
    const result = aiFails ? 'failed' : 'success';
    const update = aiFails
      ? { preemption_mode: 'failed', active_mission_id: mission.id, last_preempted_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'green', preemption_mode: 'ai_active', active_mission_id: mission.id, last_preempted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await supabase.from('traffic_signals').update(update).eq('id', signal.id);
    await supabase.from('preemption_events').insert({ mission_id: mission.id, traffic_signal_id: signal.id, trigger_distance_meters: Math.round(distMeters), requested_by: 'ai', result });
    if (aiFails) playAlert('alert');
    setPreemptionLog((cur) => [{ id: `${signal.id}-${Date.now()}`, name: signal.name, result, distanceMeters: Math.round(distMeters) }, ...cur].slice(0, 4));
  };

  const startGpsSimulation = (coords, mission, pickupIdx, signals) => {
    if (!user || coords.length < 2) return;
    if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    let idx = 0;
    let pickupMarked = false;
    setRouteProgress(0); setRoutePhase('to_patient');
    triggeredSignalsRef.current = new Set();

    simulationTimerRef.current = setInterval(async () => {
      const next = coords[idx];
      if (!next) {
        clearInterval(simulationTimerRef.current); simulationTimerRef.current = null;
        setRouteProgress(100); setRoutePhase('completed');
        playAlert('success');
        await supabase.from('active_missions').update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', mission.id);
        return;
      }
      const loc = { lng: next[0], lat: next[1] };
      setDriverLocation(loc);
      setRouteProgress(Math.round(((idx + 1) / coords.length) * 100));

      if (!pickupMarked && idx >= pickupIdx) {
        pickupMarked = true; setRoutePhase('to_hospital');
        await supabase.from('active_missions').update({ status: 'en_route_hospital', patient_picked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', mission.id);
      }
      await supabase.from('driver_locations').upsert({ driver_id: user.id, lat: loc.lat, lng: loc.lng, updated_at: new Date().toISOString() }, { onConflict: 'driver_id' });
      await Promise.all(signals.map(async (s) => {
        const m = distance(point([loc.lng, loc.lat]), point([s.lng, s.lat]), { units: 'kilometers' }) * 1000;
        if (m <= SIGNAL_GEOFENCE_METERS) await triggerPreemption(mission, s, m);
      }));
      idx += 1;
    }, SIMULATION_TICK_MS);
  };

  const buildRouteAndStartDriving = async (mission) => {
    if (!driverLocation) { setErrorMessage('Driver location not ready.'); return; }
    if (!mission.hospital) { setErrorMessage('Mission missing hospital.'); return; }
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${mission.pickup_lng},${mission.pickup_lat};${mission.hospital.lng},${mission.hospital.lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!resp.ok || !data.routes?.[0]?.geometry?.coordinates?.length) throw new Error(data.message || 'Route calculation failed.');
    const raw = data.routes[0].geometry.coordinates;
    const rawPick = findClosestCoordinateIndex(raw, { lat: mission.pickup_lat, lng: mission.pickup_lng });
    const { coordinates, pickupIndex } = buildSimulationRoute(raw, rawPick);
    const signals = await fetchSignals();
    await supabase.from('active_missions').update({ route_coordinates: coordinates, route_pickup_index: pickupIndex, updated_at: new Date().toISOString() }).eq('id', mission.id);
    drawRoute(coordinates, pickupIndex);
    if (mapRef.current) {
      if (pickupMarkerRef.current) pickupMarkerRef.current.remove();
      pickupMarkerRef.current = new mapboxgl.Marker({ element: createPickupMarker(), anchor: 'center' }).setLngLat([mission.pickup_lng, mission.pickup_lat]).addTo(mapRef.current);
      if (hospitalMarkerRef.current) hospitalMarkerRef.current.remove();
      hospitalMarkerRef.current = new mapboxgl.Marker({ element: createHospitalMarker(), anchor: 'center' }).setLngLat([mission.hospital.lng, mission.hospital.lat]).addTo(mapRef.current);
    }
    startGpsSimulation(coordinates, mission, pickupIndex, signals);
  };

  const handleAcceptMission = async () => {
    if (!user || !pendingMission || !driverLocation || isAccepting) return;
    setErrorMessage(''); setIsAccepting(true);
    const { data, error } = await supabase.from('active_missions')
      .update({ status: 'accepted', driver_id: user.id, updated_at: new Date().toISOString() })
      .eq('id', pendingMission.id).eq('status', 'pending')
      .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
      .single();
    if (error) { setErrorMessage(error.message); setIsAccepting(false); return; }
    const accepted = normalizeMission(data);
    setPendingMission(null); setActiveMission(accepted);
    playAlert('siren');
    try { await buildRouteAndStartDriving(accepted); } catch (e) { setErrorMessage(e.message || 'Route generation failed.'); }
    finally { setIsAccepting(false); }
  };

  const missionDist = formatDistanceKm(driverLocation, pendingMission);
  const dest = activeMission?.hospital || pendingMission?.hospital;

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {!driverLocation && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950 text-center">
          <div className="flex max-w-xs flex-col items-center gap-4 px-6 fade-in">
            <Loader2 className="h-10 w-10 animate-spin text-blue-300" />
            <div>
              <p className="text-lg font-bold">{locationStatus}</p>
              <p className="mt-2 text-sm text-slate-400">Driver GPS required before accepting missions.</p>
            </div>
            <button type="button" onClick={() => applyDriverLocation(TEST_DRIVER_LOCATION, 'Using test ambulance location')}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-100 active:scale-[0.99]">
              Use Test Location
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Driver Mode</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <Crosshair className="h-4 w-4 text-blue-300" />
            {activeMission ? 'Mission active' : locationStatus}
          </p>
        </div>
        <button type="button" onClick={signOut} aria-label="Sign out"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur active:scale-95">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      {/* Pending mission popup */}
      {pendingMission && !activeMission && driverLocation && (
        <section className="absolute inset-x-4 top-1/2 z-30 -translate-y-1/2 rounded-3xl border border-red-300/30 bg-red-950/95 p-5 text-center shadow-2xl shadow-red-950/60 backdrop-blur fade-in">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500 text-white shadow-xl siren-flash">
            <Siren className="h-9 w-9" />
          </div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-red-200">Emergency Request</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-white">Request at {missionDist}</h1>
          <p className="mt-3 text-sm font-medium text-red-100">
            Pickup is locked. Destination: {pendingMission.hospital?.name || 'selected emergency hospital'}.
          </p>
          <button type="button" onClick={handleAcceptMission} disabled={isAccepting || !driverLocation}
            className="mt-5 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 text-lg font-black uppercase tracking-wide text-red-700 shadow-xl transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60">
            {isAccepting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Truck className="h-7 w-7" />}
            Accept Mission
          </button>
        </section>
      )}

      {/* Bottom panel */}
      <section className="absolute bottom-0 left-0 right-0 z-20 max-h-[62vh] overflow-y-auto custom-scrollbar rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Ambulance Unit</p>
              <h2 className="mt-1 text-2xl font-black text-white">
                {routePhase === 'to_hospital' ? 'Driving to Hospital' : activeMission ? 'Driving to Patient' : pendingMission ? 'Request Waiting' : 'Standing By'}
              </h2>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${activeMission ? 'bg-blue-400/15 text-blue-300' : 'bg-slate-800 text-slate-300'}`}>
              {activeMission ? <Navigation className="h-7 w-7" /> : <Radio className="h-7 w-7" />}
            </div>
          </div>

          {dest && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm font-semibold text-emerald-100 slide-in">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Destination Hospital</p>
                <p className="mt-1 text-white">{dest.name}</p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100 slide-in">{errorMessage}</div>
          )}

          {activeMission && (
            <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-blue-100">
                <span>Route simulation</span>
                <span>{routeProgress}%</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full progress-shimmer transition-all" style={{ width: `${routeProgress}%` }} />
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-400 live-dot" />
                <span className="text-xs font-semibold text-blue-300">{routePhase === 'to_patient' ? 'En route to patient' : routePhase === 'to_hospital' ? 'En route to hospital' : routePhase === 'completed' ? 'Mission complete' : 'Standby'}</span>
              </div>
            </div>
          )}

          {preemptionLog.length > 0 && (
            <div className="mt-4 grid gap-2">
              {preemptionLog.map((ev, i) => (
                <div key={ev.id} style={{ animationDelay: `${i * 80}ms` }}
                  className={`flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold slide-in ${ev.result === 'success' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'}`}>
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p>{ev.result === 'success' ? 'AI preemption active' : 'AI failed, police override needed'}</p>
                    <p className="mt-1 text-xs opacity-80">{ev.name} at {ev.distanceMeters} m</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!activeMission && !pendingMission && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-sm font-semibold text-slate-300">
              <MapPin className="h-5 w-5 shrink-0 text-blue-300" />
              Listening for pending emergency missions.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
