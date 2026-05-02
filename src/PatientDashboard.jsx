import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import {
  Building2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Radio,
  ShieldAlert,
  Siren,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';
import { autoDispatchMission } from './utils/autoDispatch';
import useAlertSound from './hooks/useAlertSound';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TEST_LOCATION = { lat: 17.4065, lng: 78.4772 };

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function createPatientMarker() {
  const marker = document.createElement('div');
  marker.innerHTML = `
    <div style="width:22px;height:22px;border-radius:9999px;background:#22d3ee;border:4px solid white;box-shadow:0 0 0 8px rgba(34,211,238,0.24),0 12px 28px rgba(8,47,73,0.45);"></div>
    <div style="position:absolute;top:28px;left:50%;transform:translateX(-50%);white-space:nowrap;border-radius:9999px;background:rgba(15,23,42,0.92);color:white;font-size:12px;font-weight:700;padding:5px 10px;border:1px solid rgba(148,163,184,0.35);">You are here</div>
  `;
  marker.style.position = 'relative';
  marker.style.display = 'flex';
  marker.style.alignItems = 'center';
  marker.style.justifyContent = 'center';
  return marker;
}

function createAmbulanceMarker() {
  const marker = document.createElement('div');
  marker.innerHTML = `
    <div style="width:34px;height:34px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#ef4444;color:white;border:4px solid white;font-size:19px;box-shadow:0 0 0 8px rgba(239,68,68,0.25),0 12px 32px rgba(127,29,29,0.5);">+</div>
  `;
  return marker;
}

function createHospitalMarker(hospital, isSelected) {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.setAttribute('aria-label', `${hospital.name} hospital`);
  marker.style.width = isSelected ? '36px' : '28px';
  marker.style.height = isSelected ? '36px' : '28px';
  marker.style.borderRadius = '9999px';
  marker.style.border = '4px solid white';
  marker.style.background = isSelected ? '#22c55e' : '#0ea5e9';
  marker.style.boxShadow = isSelected
    ? '0 0 0 9px rgba(34,197,94,0.22),0 12px 28px rgba(20,83,45,0.45)'
    : '0 0 0 7px rgba(14,165,233,0.2),0 12px 28px rgba(8,47,73,0.35)';
  marker.style.cursor = 'pointer';
  marker.style.padding = '0';
  return marker;
}

function formatDist(km) {
  if (km == null) return 'nearby';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function formatEta(km) {
  if (km == null) return '--';
  const minutes = Math.round((km / 40) * 60); // ~40 km/h avg urban
  if (minutes < 1) return '< 1 min';
  return `${minutes} min`;
}

function missionStatusLabel(status) {
  if (status === 'en_route_hospital') return 'En Route to Hospital';
  if (status === 'completed') return 'Mission Complete';
  if (status === 'accepted') return 'Ambulance En Route';
  return 'Finding Driver...';
}

export default function PatientDashboard() {
  const { signOut, user } = useAuth();
  const { playAlert } = useAlertSound();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const patientMarkerRef = useRef(null);
  const ambulanceMarkerRef = useRef(null);
  const hospitalMarkersRef = useRef(new Map());

  const [patientLocation, setPatientLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('Locating you...');
  const [hospitals, setHospitals] = useState([]);
  const [selectedHospitalId, setSelectedHospitalId] = useState('');
  const [activeMission, setActiveMission] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [preemptionEvents, setPreemptionEvents] = useState([]);
  const [isRequesting, setIsRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const prevStatusRef = useRef(null);

  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.id === selectedHospitalId) || null,
    [hospitals, selectedHospitalId],
  );

  // Ambulance ETA
  const ambulanceEta = useMemo(() => {
    if (!driverLocation || !patientLocation) return null;
    const km = distance(
      point([driverLocation.lng, driverLocation.lat]),
      point([patientLocation.lng, patientLocation.lat]),
      { units: 'kilometers' },
    );
    return { km, eta: formatEta(km), dist: formatDist(km) };
  }, [driverLocation, patientLocation]);

  const applyPatientLocation = useCallback((loc, status = 'Location locked') => {
    setPatientLocation(loc);
    setLocationStatus(status);
    setErrorMessage('');
  }, []);

  const requestPatientLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not available in this browser.');
      setLocationStatus('Location unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPatientLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        setErrorMessage('Location permission is required to request an ambulance.');
        setLocationStatus('Location permission needed');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }, [applyPatientLocation]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErrorMessage('Missing VITE_MAPBOX_TOKEN.'); return; }
    requestPatientLocation();
  }, [requestPatientLocation]);

  // Fetch hospitals
  useEffect(() => {
    if (!patientLocation) return undefined;
    let mounted = true;
    async function fetch_() {
      const { data, error } = await supabase
        .from('hospitals')
        .select('id, name, lat, lng, trauma_level, emergency_available, multispeciality')
        .eq('emergency_available', true)
        .eq('multispeciality', true);
      if (!mounted) return;
      if (error) { setErrorMessage(error.message); return; }
      const ranked = (data || [])
        .map((h) => ({
          ...h,
          distanceKm: distance(point([patientLocation.lng, patientLocation.lat]), point([h.lng, h.lat]), { units: 'kilometers' }),
        }))
        .sort((a, b) => {
          if (a.trauma_level !== b.trauma_level) return a.trauma_level - b.trauma_level;
          return a.distanceKm - b.distanceKm;
        });
      setHospitals(ranked);
      setSelectedHospitalId((cur) => cur || ranked[0]?.id || '');
    }
    fetch_();
    return () => { mounted = false; };
  }, [patientLocation]);

  // Init map
  useEffect(() => {
    if (!patientLocation || !mapContainerRef.current || mapRef.current) return undefined;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [patientLocation.lng, patientLocation.lat],
      zoom: 14.2,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    patientMarkerRef.current = new mapboxgl.Marker({ element: createPatientMarker(), anchor: 'center' })
      .setLngLat([patientLocation.lng, patientLocation.lat])
      .addTo(map);
    mapRef.current = map;
    return () => {
      patientMarkerRef.current?.remove();
      ambulanceMarkerRef.current?.remove();
      hospitalMarkersRef.current.forEach((m) => m.remove());
      hospitalMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      patientMarkerRef.current = null;
      ambulanceMarkerRef.current = null;
    };
  }, [patientLocation]);

  // Sync patient marker
  useEffect(() => {
    if (!mapRef.current || !patientLocation || !patientMarkerRef.current) return;
    patientMarkerRef.current.setLngLat([patientLocation.lng, patientLocation.lat]);
  }, [patientLocation]);

  // Render hospital markers
  useEffect(() => {
    if (!mapRef.current) return;
    const ids = new Set();
    hospitals.forEach((h) => {
      ids.add(h.id);
      const existing = hospitalMarkersRef.current.get(h.id);
      if (existing) existing.remove();
      const el = createHospitalMarker(h, h.id === selectedHospitalId);
      el.addEventListener('click', () => { if (!activeMission) setSelectedHospitalId(h.id); });
      const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lng, h.lat]).addTo(mapRef.current);
      hospitalMarkersRef.current.set(h.id, m);
    });
    hospitalMarkersRef.current.forEach((m, id) => { if (!ids.has(id)) { m.remove(); hospitalMarkersRef.current.delete(id); } });
  }, [activeMission, hospitals, selectedHospitalId]);

  // Subscribe to mission updates
  useEffect(() => {
    if (!activeMission?.id) return undefined;
    const ch = supabase.channel(`mission-${activeMission.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'active_missions', filter: `id=eq.${activeMission.id}` }, (p) => setActiveMission(p.new))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeMission?.id]);

  // Siren on status change
  useEffect(() => {
    if (!activeMission?.status) return;
    if (prevStatusRef.current && prevStatusRef.current !== activeMission.status) {
      if (activeMission.status === 'accepted') playAlert('siren');
      else if (activeMission.status === 'en_route_hospital') playAlert('success');
      else if (activeMission.status === 'completed') playAlert('success');
    }
    prevStatusRef.current = activeMission.status;
  }, [activeMission?.status, playAlert]);

  // Subscribe to preemption events
  useEffect(() => {
    if (!activeMission?.id) { setPreemptionEvents([]); return undefined; }
    let mounted = true;
    async function fetch_() {
      const { data } = await supabase.from('preemption_events')
        .select('id, trigger_distance_meters, requested_by, result, created_at, traffic_signals(name)')
        .eq('mission_id', activeMission.id).order('created_at', { ascending: false }).limit(4);
      if (mounted) setPreemptionEvents(data || []);
    }
    fetch_();
    const ch = supabase.channel(`patient-preemption-${activeMission.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'preemption_events', filter: `mission_id=eq.${activeMission.id}` }, fetch_)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [activeMission?.id]);

  // Track driver location
  useEffect(() => {
    const driverId = ['accepted', 'en_route_hospital', 'completed'].includes(activeMission?.status) ? activeMission.driver_id : null;
    if (!driverId) { setDriverLocation(null); return undefined; }
    let mounted = true;
    async function fetch_() {
      const { data } = await supabase.from('driver_locations').select('driver_id, lat, lng, updated_at').eq('driver_id', driverId).maybeSingle();
      if (mounted && data) setDriverLocation({ lat: data.lat, lng: data.lng });
    }
    fetch_();
    const ch = supabase.channel(`driver-loc-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` }, (p) => {
        if (p.new) setDriverLocation({ lat: p.new.lat, lng: p.new.lng });
      })
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [activeMission?.driver_id, activeMission?.status]);

  // Render ambulance marker + route line
  useEffect(() => {
    if (!driverLocation || !mapRef.current) return;
    const lngLat = [driverLocation.lng, driverLocation.lat];
    if (!ambulanceMarkerRef.current) {
      ambulanceMarkerRef.current = new mapboxgl.Marker({ element: createAmbulanceMarker(), anchor: 'center' }).setLngLat(lngLat).addTo(mapRef.current);
    } else {
      ambulanceMarkerRef.current.setLngLat(lngLat);
    }
    // Draw route line from ambulance to patient
    if (patientLocation) {
      const routeGeoJSON = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: [lngLat, [patientLocation.lng, patientLocation.lat]] },
      };
      if (mapRef.current.getSource('amb-route')) {
        mapRef.current.getSource('amb-route').setData(routeGeoJSON);
      } else if (mapRef.current.loaded()) {
        mapRef.current.addSource('amb-route', { type: 'geojson', data: routeGeoJSON });
        mapRef.current.addLayer({
          id: 'amb-route-line', type: 'line', source: 'amb-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#3b82f6', 'line-opacity': 0.7, 'line-width': 4, 'line-dasharray': [2, 3] },
        });
      }
    }
  }, [driverLocation, patientLocation]);

  // Auto-dispatch SOS
  const handleRequestAmbulance = async () => {
    if (!user || !patientLocation || !selectedHospital || isRequesting || activeMission) return;
    setErrorMessage('');
    setIsRequesting(true);
    playAlert('siren');

    const result = await autoDispatchMission(user, patientLocation, selectedHospital);

    if (result.error) {
      setErrorMessage(result.error);
      setIsRequesting(false);
      return;
    }
    setActiveMission(result.mission);
    setIsRequesting(false);
  };

  // Cancel mission
  const handleCancelMission = async () => {
    if (!activeMission?.id) return;
    await supabase.from('active_missions').delete().eq('id', activeMission.id);
    setActiveMission(null);
    setDriverLocation(null);
    setPreemptionEvents([]);
    if (ambulanceMarkerRef.current) { ambulanceMarkerRef.current.remove(); ambulanceMarkerRef.current = null; }
    if (mapRef.current?.getSource('amb-route')) {
      mapRef.current.removeLayer('amb-route-line');
      mapRef.current.removeSource('amb-route');
    }
  };

  const hasMission = Boolean(activeMission);
  const isSearching = hasMission && activeMission.status === 'pending';
  const isAccepted = ['accepted', 'en_route_hospital', 'completed'].includes(activeMission?.status);
  const topHospitals = hospitals.slice(0, 3);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {/* Location loading overlay */}
      {!patientLocation && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950 text-center">
          <div className="flex max-w-xs flex-col items-center gap-4 px-6 fade-in">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
            <div>
              <p className="text-lg font-bold">{locationStatus}</p>
              <p className="mt-2 text-sm text-slate-400">Your location is needed so dispatch can find you.</p>
            </div>
            <div className="grid w-full gap-3">
              <button type="button" onClick={requestPatientLocation} className="h-12 rounded-xl bg-cyan-400 px-4 text-sm font-black uppercase tracking-wide text-slate-950 active:scale-[0.99]">Retry Location</button>
              <button type="button" onClick={() => applyPatientLocation(TEST_LOCATION, 'Using test location')} className="h-12 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-100 active:scale-[0.99]">Use Test Location</button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Patient Mode</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <MapPin className="h-4 w-4 text-cyan-300" />
            {locationStatus}
          </p>
        </div>
        <button type="button" onClick={signOut} aria-label="Sign out" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur active:scale-95">
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      {/* Bottom panel */}
      <section className="absolute bottom-0 left-0 right-0 z-20 max-h-[72vh] overflow-y-auto custom-scrollbar rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Emergency Dispatch</p>
              <h1 className="mt-1 text-2xl font-black text-white">
                {hasMission ? missionStatusLabel(activeMission.status) : 'One-Tap SOS'}
              </h1>
            </div>
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${isAccepted ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
              {isAccepted ? <Siren className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
            </div>
          </div>

          {errorMessage && (
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100 slide-in">{errorMessage}</div>
          )}

          {/* Selected hospital */}
          {selectedHospital && (
            <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 slide-in">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Auto-selected hospital</p>
                  <h2 className="mt-1 text-lg font-black leading-tight text-white">{selectedHospital.name}</h2>
                  <p className="mt-1 text-sm font-semibold text-emerald-100">
                    Level-{selectedHospital.trauma_level} trauma, {formatDist(selectedHospital.distanceKm)} away
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Hospital list (pre-mission) */}
          {!hasMission && topHospitals.length > 0 && (
            <div className="mb-4 grid gap-2">
              {topHospitals.map((h) => {
                const isSel = h.id === selectedHospitalId;
                return (
                  <button key={h.id} type="button" onClick={() => setSelectedHospitalId(h.id)}
                    className={`flex min-h-[58px] items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left active:scale-[0.99] ${isSel ? 'border-emerald-300/40 bg-emerald-400/15 text-white' : 'border-slate-800 bg-slate-900/80 text-slate-200'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{h.name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">Level-{h.trauma_level} trauma — {formatDist(h.distanceKm)}</p>
                    </div>
                    {isSel && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Live ETA card */}
          {isAccepted && ambulanceEta && activeMission.status !== 'completed' && (
            <div className="mb-4 rounded-2xl border border-cyan-400/20 eta-gradient p-4 slide-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15">
                    <Clock className="h-5 w-5 text-cyan-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
                      {activeMission.status === 'en_route_hospital' ? 'ETA to Hospital' : 'Ambulance ETA'}
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">{ambulanceEta.eta}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-cyan-100">{ambulanceEta.dist}</p>
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-emerald-400 live-dot" />
                    <span className="text-xs font-semibold text-emerald-300">LIVE</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Driver accepted */}
          {isAccepted && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm font-semibold text-emerald-100 slide-in">
              <Radio className="h-5 w-5 shrink-0 text-emerald-300" />
              {activeMission.status === 'accepted' ? 'Driver assigned. Tracking ambulance live.' : activeMission.status === 'en_route_hospital' ? 'Patient picked up. Heading to hospital.' : 'Mission completed.'}
            </div>
          )}

          {/* Preemption events */}
          {preemptionEvents.length > 0 && (
            <div className="mb-4 grid gap-2">
              {preemptionEvents.map((ev, i) => {
                const fail = ev.result === 'failed';
                const manual = ev.result === 'manual_override';
                return (
                  <div key={ev.id} className={`flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold slide-in ${fail ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : manual ? 'border-blue-400/30 bg-blue-400/10 text-blue-100' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'}`}
                    style={{ animationDelay: `${i * 80}ms` }}>
                    {fail ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> : <Zap className="mt-0.5 h-5 w-5 shrink-0" />}
                    <div>
                      <p>{fail ? 'AI preemption failed, police alerted' : manual ? 'Police override activated' : 'AI preemption cleared signal'}</p>
                      <p className="mt-1 text-xs opacity-80">{ev.traffic_signals?.name || 'Traffic signal'} — {ev.trigger_distance_meters} m</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* SOS / Status button */}
          <button type="button" onClick={handleRequestAmbulance}
            disabled={!patientLocation || !selectedHospital || isRequesting || hasMission}
            className={`flex h-20 w-full items-center justify-center gap-3 rounded-3xl px-5 text-center text-xl font-black uppercase tracking-wide shadow-2xl transition active:scale-[0.99] disabled:cursor-not-allowed ${hasMission ? 'bg-slate-600 text-slate-200 shadow-black/30' : 'bg-red-600 text-white shadow-red-950/50 hover:bg-red-500 sos-pulse'}`}>
            {isRequesting ? <Loader2 className="h-7 w-7 animate-spin" />
              : hasMission ? <Navigation className="h-7 w-7" />
              : <ShieldAlert className="h-8 w-8" />}
            {hasMission ? (isSearching ? 'Searching for Driver...' : missionStatusLabel(activeMission.status)) : 'SOS — Auto Dispatch'}
          </button>

          {/* Cancel button */}
          {hasMission && activeMission.status !== 'completed' && (
            <button type="button" onClick={handleCancelMission}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 text-sm font-bold text-slate-300 active:scale-[0.99]">
              <X className="h-4 w-4" /> Cancel Mission
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
