import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import {
  Building2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  Radio,
  ShieldAlert,
  Siren,
  Zap,
} from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TEST_LOCATION = {
  lat: 17.4065,
  lng: 78.4772,
};

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function createPatientMarker() {
  const marker = document.createElement('div');
  marker.className = 'patient-location-marker';
  marker.innerHTML = `
    <div style="
      width: 22px;
      height: 22px;
      border-radius: 9999px;
      background: #22d3ee;
      border: 4px solid white;
      box-shadow: 0 0 0 8px rgba(34, 211, 238, 0.24), 0 12px 28px rgba(8, 47, 73, 0.45);
    "></div>
    <div style="
      position: absolute;
      top: 28px;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      border-radius: 9999px;
      background: rgba(15, 23, 42, 0.92);
      color: white;
      font-size: 12px;
      font-weight: 700;
      padding: 5px 10px;
      border: 1px solid rgba(148, 163, 184, 0.35);
    ">You are here</div>
  `;
  marker.style.position = 'relative';
  marker.style.display = 'flex';
  marker.style.alignItems = 'center';
  marker.style.justifyContent = 'center';
  return marker;
}

function createAmbulanceMarker() {
  const marker = document.createElement('div');
  marker.className = 'ambulance-location-marker';
  marker.innerHTML = `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ef4444;
      color: white;
      border: 4px solid white;
      font-size: 19px;
      box-shadow: 0 12px 32px rgba(127, 29, 29, 0.5);
    ">+</div>
  `;
  return marker;
}

function createHospitalMarker(hospital, isSelected) {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'hospital-location-marker';
  marker.setAttribute('aria-label', `${hospital.name} hospital`);
  marker.style.width = isSelected ? '36px' : '28px';
  marker.style.height = isSelected ? '36px' : '28px';
  marker.style.borderRadius = '9999px';
  marker.style.border = '4px solid white';
  marker.style.background = isSelected ? '#22c55e' : '#0ea5e9';
  marker.style.boxShadow = isSelected
    ? '0 0 0 9px rgba(34, 197, 94, 0.22), 0 12px 28px rgba(20, 83, 45, 0.45)'
    : '0 0 0 7px rgba(14, 165, 233, 0.2), 0 12px 28px rgba(8, 47, 73, 0.35)';
  marker.style.cursor = 'pointer';
  marker.style.padding = '0';
  return marker;
}

function formatDistanceKm(km) {
  if (km == null) return 'nearby';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function missionStatusLabel(status) {
  if (status === 'en_route_hospital') return 'Patient picked up';
  if (status === 'completed') return 'Mission complete';
  if (status === 'accepted') return 'Ambulance en route';
  return 'Finding driver';
}

export default function PatientDashboard() {
  const { signOut, user } = useAuth();
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

  const selectedHospital = useMemo(
    () => hospitals.find((hospital) => hospital.id === selectedHospitalId) || null,
    [hospitals, selectedHospitalId],
  );

  const applyPatientLocation = useCallback((nextLocation, nextStatus = 'Location locked') => {
    setPatientLocation(nextLocation);
    setLocationStatus(nextStatus);
    setErrorMessage('');
  }, []);

  const requestPatientLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not available in this browser.');
      setLocationStatus('Location unavailable');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyPatientLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setErrorMessage('Location permission is required to request an ambulance.');
        setLocationStatus('Location permission needed');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      },
    );
  }, [applyPatientLocation]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setErrorMessage('Missing VITE_MAPBOX_TOKEN.');
      return;
    }

    requestPatientLocation();
  }, [requestPatientLocation]);

  useEffect(() => {
    if (!patientLocation) return undefined;

    let isMounted = true;

    async function fetchHospitals() {
      const { data, error } = await supabase
        .from('hospitals')
        .select('id, name, lat, lng, trauma_level, emergency_available, multispeciality')
        .eq('emergency_available', true)
        .eq('multispeciality', true);

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message || 'Unable to load nearby emergency hospitals.');
        return;
      }

      const rankedHospitals = (data || [])
        .map((hospital) => ({
          ...hospital,
          distanceKm: distance(
            point([patientLocation.lng, patientLocation.lat]),
            point([hospital.lng, hospital.lat]),
            { units: 'kilometers' },
          ),
        }))
        .sort((left, right) => {
          if (left.trauma_level !== right.trauma_level) return left.trauma_level - right.trauma_level;
          return left.distanceKm - right.distanceKm;
        });

      setHospitals(rankedHospitals);
      setSelectedHospitalId((current) => current || rankedHospitals[0]?.id || '');
    }

    fetchHospitals();

    return () => {
      isMounted = false;
    };
  }, [patientLocation]);

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
      hospitalMarkersRef.current.forEach((marker) => marker.remove());
      hospitalMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
      patientMarkerRef.current = null;
      ambulanceMarkerRef.current = null;
    };
  }, [patientLocation]);

  useEffect(() => {
    if (!mapRef.current || !patientLocation || !patientMarkerRef.current) return;

    patientMarkerRef.current.setLngLat([patientLocation.lng, patientLocation.lat]);
    mapRef.current.easeTo({
      center: [patientLocation.lng, patientLocation.lat],
      duration: 800,
      zoom: 14.2,
    });
  }, [patientLocation]);

  useEffect(() => {
    if (!mapRef.current) return;

    const renderedIds = new Set();

    hospitals.forEach((hospital) => {
      renderedIds.add(hospital.id);
      const existing = hospitalMarkersRef.current.get(hospital.id);
      if (existing) existing.remove();

      const markerElement = createHospitalMarker(hospital, hospital.id === selectedHospitalId);
      markerElement.addEventListener('click', () => {
        if (!activeMission) setSelectedHospitalId(hospital.id);
      });

      const marker = new mapboxgl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat([hospital.lng, hospital.lat])
        .addTo(mapRef.current);

      hospitalMarkersRef.current.set(hospital.id, marker);
    });

    hospitalMarkersRef.current.forEach((marker, hospitalId) => {
      if (!renderedIds.has(hospitalId)) {
        marker.remove();
        hospitalMarkersRef.current.delete(hospitalId);
      }
    });
  }, [activeMission, hospitals, selectedHospitalId]);

  useEffect(() => {
    if (!activeMission?.id) return undefined;

    const missionChannel = supabase
      .channel(`active-mission-${activeMission.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'active_missions',
          filter: `id=eq.${activeMission.id}`,
        },
        (payload) => {
          setActiveMission(payload.new);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(missionChannel);
    };
  }, [activeMission?.id]);

  useEffect(() => {
    if (!activeMission?.id) {
      setPreemptionEvents([]);
      return undefined;
    }

    let isMounted = true;

    async function fetchPreemptionEvents() {
      const { data, error } = await supabase
        .from('preemption_events')
        .select('id, trigger_distance_meters, requested_by, result, created_at, traffic_signals(name)')
        .eq('mission_id', activeMission.id)
        .order('created_at', { ascending: false })
        .limit(4);

      if (!isMounted || error) return;
      setPreemptionEvents(data || []);
    }

    fetchPreemptionEvents();

    const channel = supabase
      .channel(`patient-preemption-${activeMission.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'preemption_events',
          filter: `mission_id=eq.${activeMission.id}`,
        },
        fetchPreemptionEvents,
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [activeMission?.id]);

  useEffect(() => {
    const driverId = ['accepted', 'en_route_hospital', 'completed'].includes(activeMission?.status)
      ? activeMission.driver_id
      : null;
    if (!driverId) {
      setDriverLocation(null);
      return undefined;
    }

    let isMounted = true;

    async function fetchLatestDriverLocation() {
      const { data, error } = await supabase
        .from('driver_locations')
        .select('driver_id, lat, lng, updated_at')
        .eq('driver_id', driverId)
        .maybeSingle();

      if (!isMounted || error || !data) return;
      setDriverLocation({ lat: data.lat, lng: data.lng, updatedAt: data.updated_at });
    }

    fetchLatestDriverLocation();

    const driverChannel = supabase
      .channel(`driver-location-${driverId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_locations',
          filter: `driver_id=eq.${driverId}`,
        },
        (payload) => {
          if (!payload.new) return;
          setDriverLocation({
            lat: payload.new.lat,
            lng: payload.new.lng,
            updatedAt: payload.new.updated_at,
          });
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(driverChannel);
    };
  }, [activeMission?.driver_id, activeMission?.status]);

  useEffect(() => {
    if (!driverLocation || !mapRef.current) return;

    const lngLat = [driverLocation.lng, driverLocation.lat];

    if (!ambulanceMarkerRef.current) {
      ambulanceMarkerRef.current = new mapboxgl.Marker({
        element: createAmbulanceMarker(),
        anchor: 'center',
      })
        .setLngLat(lngLat)
        .addTo(mapRef.current);
    } else {
      ambulanceMarkerRef.current.setLngLat(lngLat);
    }
  }, [driverLocation]);

  const handleRequestAmbulance = async () => {
    if (!user || !patientLocation || !selectedHospital || isRequesting || activeMission) return;

    setErrorMessage('');
    setIsRequesting(true);

    const { data, error } = await supabase
      .from('active_missions')
      .insert({
        patient_id: user.id,
        hospital_id: selectedHospital.id,
        pickup_lat: patientLocation.lat,
        pickup_lng: patientLocation.lng,
        status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, updated_at')
      .single();

    if (error) {
      setErrorMessage(error.message || 'Unable to request an ambulance.');
      setIsRequesting(false);
      return;
    }

    setActiveMission(data);
    setIsRequesting(false);
  };

  const hasMission = Boolean(activeMission);
  const isSearching = hasMission && activeMission.status === 'pending';
  const isAccepted = ['accepted', 'en_route_hospital', 'completed'].includes(activeMission?.status);
  const topHospitals = hospitals.slice(0, 3);

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {!patientLocation && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950 text-center">
          <div className="flex max-w-xs flex-col items-center gap-4 px-6">
            <Loader2 className="h-10 w-10 animate-spin text-cyan-300" />
            <div>
              <p className="text-lg font-bold">{locationStatus}</p>
              <p className="mt-2 text-sm text-slate-400">Your location is needed so dispatch can find you.</p>
            </div>
            <div className="grid w-full gap-3">
              <button
                type="button"
                onClick={requestPatientLocation}
                className="h-12 rounded-xl bg-cyan-400 px-4 text-sm font-black uppercase tracking-wide text-slate-950 active:scale-[0.99]"
              >
                Retry Location
              </button>
              <button
                type="button"
                onClick={() => applyPatientLocation(TEST_LOCATION, 'Using test location')}
                className="h-12 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-100 active:scale-[0.99]"
              >
                Use Test Location
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Patient Mode</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <MapPin className="h-4 w-4 text-cyan-300" />
            {locationStatus}
          </p>
        </div>

        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/85 text-slate-100 shadow-xl backdrop-blur active:scale-95"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <section className="absolute bottom-0 left-0 right-0 z-20 max-h-[68vh] overflow-y-auto rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">
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
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100">
              {errorMessage}
            </div>
          )}

          {selectedHospital && (
            <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Auto-selected hospital</p>
                  <h2 className="mt-1 text-lg font-black leading-tight text-white">{selectedHospital.name}</h2>
                  <p className="mt-1 text-sm font-semibold text-emerald-100">
                    Level-{selectedHospital.trauma_level} trauma, {formatDistanceKm(selectedHospital.distanceKm)} away
                  </p>
                </div>
              </div>
            </div>
          )}

          {!hasMission && topHospitals.length > 0 && (
            <div className="mb-4 grid gap-2">
              {topHospitals.map((hospital) => {
                const isSelected = hospital.id === selectedHospitalId;
                return (
                  <button
                    key={hospital.id}
                    type="button"
                    onClick={() => setSelectedHospitalId(hospital.id)}
                    className={`flex min-h-[58px] items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left active:scale-[0.99] ${
                      isSelected
                        ? 'border-emerald-300/40 bg-emerald-400/15 text-white'
                        : 'border-slate-800 bg-slate-900/80 text-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{hospital.name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        Level-{hospital.trauma_level} trauma - {formatDistanceKm(hospital.distanceKm)}
                      </p>
                    </div>
                    {isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />}
                  </button>
                );
              })}
            </div>
          )}

          {isAccepted && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm font-semibold text-emerald-100">
              <Radio className="h-5 w-5 shrink-0 text-emerald-300" />
              Driver accepted. Tracking ambulance and preemption live.
            </div>
          )}

          {preemptionEvents.length > 0 && (
            <div className="mb-4 grid gap-2">
              {preemptionEvents.map((event) => {
                const isFailure = event.result === 'failed';
                const isManual = event.result === 'manual_override';
                return (
                  <div
                    key={event.id}
                    className={`flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold ${
                      isFailure
                        ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                        : isManual
                          ? 'border-blue-400/30 bg-blue-400/10 text-blue-100'
                          : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                    }`}
                  >
                    {isFailure ? (
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    ) : (
                      <Zap className="mt-0.5 h-5 w-5 shrink-0" />
                    )}
                    <div>
                      <p>
                        {isFailure
                          ? 'AI preemption failed, police alerted'
                          : isManual
                            ? 'Police override activated'
                            : 'AI preemption turned signal green'}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {event.traffic_signals?.name || 'Traffic signal'} - {event.trigger_distance_meters} m
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={handleRequestAmbulance}
            disabled={!patientLocation || !selectedHospital || isRequesting || hasMission}
            className={`flex h-20 w-full items-center justify-center gap-3 rounded-3xl px-5 text-center text-xl font-black uppercase tracking-wide shadow-2xl transition active:scale-[0.99] disabled:cursor-not-allowed ${
              hasMission
                ? 'bg-slate-600 text-slate-200 shadow-black/30'
                : 'bg-red-600 text-white shadow-red-950/50 hover:bg-red-500'
            }`}
          >
            {isRequesting ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : hasMission ? (
              <Navigation className="h-7 w-7" />
            ) : (
              <ShieldAlert className="h-8 w-8" />
            )}
            {hasMission ? (isSearching ? 'Searching for Driver...' : missionStatusLabel(activeMission.status)) : 'SOS - Auto Dispatch'}
          </button>
        </div>
      </section>
    </main>
  );
}
