import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Building2, Crosshair, Loader2, LogOut, MapPin, Navigation, Radio, ShieldCheck, Siren, Truck } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TEST_DRIVER_LOCATION = {
  lat: 17.4432,
  lng: 78.4986,
};
const SIGNAL_GEOFENCE_METERS = 500;
const MAX_PATIENT_LEG_POINTS = 45;
const MAX_HOSPITAL_LEG_POINTS = 75;
const SIMULATION_TICK_MS = 350;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function createDriverMarker() {
  const marker = document.createElement('div');
  marker.className = 'driver-location-marker';
  marker.innerHTML = `
    <div style="
      width: 34px;
      height: 34px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2563eb;
      color: white;
      border: 4px solid white;
      font-size: 18px;
      font-weight: 900;
      box-shadow: 0 12px 32px rgba(30, 64, 175, 0.5);
    ">+</div>
  `;
  return marker;
}

function createPickupMarker() {
  const marker = document.createElement('div');
  marker.className = 'pickup-location-marker';
  marker.innerHTML = `
    <div style="
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      background: #ef4444;
      border: 4px solid white;
      box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.22), 0 12px 28px rgba(127, 29, 29, 0.45);
    "></div>
  `;
  return marker;
}

function createHospitalMarker() {
  const marker = document.createElement('div');
  marker.className = 'driver-hospital-marker';
  marker.innerHTML = `
    <div style="
      width: 30px;
      height: 30px;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #22c55e;
      color: white;
      border: 4px solid white;
      font-size: 19px;
      font-weight: 900;
      box-shadow: 0 0 0 8px rgba(34, 197, 94, 0.22), 0 12px 28px rgba(20, 83, 45, 0.45);
    ">H</div>
  `;
  return marker;
}

function formatDistanceKm(driverLocation, mission) {
  if (!driverLocation || !mission) return 'nearby';

  const km = distance(
    point([driverLocation.lng, driverLocation.lat]),
    point([mission.pickup_lng, mission.pickup_lat]),
    { units: 'kilometers' },
  );

  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

function findClosestCoordinateIndex(coordinates, target) {
  if (!coordinates.length || !target) return 0;

  return coordinates.reduce(
    (best, coordinate, index) => {
      const km = distance(point(coordinate), point([target.lng, target.lat]), { units: 'kilometers' });
      return km < best.km ? { index, km } : best;
    },
    { index: 0, km: Number.POSITIVE_INFINITY },
  ).index;
}

function sampleCoordinateRange(coordinates, startIndex, endIndex, maxPoints) {
  const start = Math.max(0, startIndex);
  const end = Math.min(coordinates.length - 1, endIndex);
  const span = coordinates.slice(start, end + 1);

  if (span.length <= maxPoints) return span;

  const sampled = [];
  const step = (span.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(span[Math.round(index * step)]);
  }

  return sampled;
}

function buildSimulationRoute(coordinates, pickupIndex) {
  const patientLeg = sampleCoordinateRange(coordinates, 0, pickupIndex, MAX_PATIENT_LEG_POINTS);
  const hospitalLeg = sampleCoordinateRange(coordinates, pickupIndex, coordinates.length - 1, MAX_HOSPITAL_LEG_POINTS);

  return {
    coordinates: [...patientLeg, ...hospitalLeg.slice(1)],
    pickupIndex: patientLeg.length - 1,
  };
}

function normalizeMission(mission) {
  if (!mission) return null;

  return {
    ...mission,
    hospital: mission.hospitals || mission.hospital || null,
  };
}

export default function DriverDashboard() {
  const { signOut, user } = useAuth();
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

  const applyDriverLocation = (nextLocation, nextStatus = 'Ambulance online') => {
    setDriverLocation(nextLocation);
    setLocationStatus(nextStatus);
    setErrorMessage('');
  };

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setErrorMessage('Missing VITE_MAPBOX_TOKEN.');
      return;
    }

    if (!navigator.geolocation) {
      setLocationStatus('Location unavailable');
      setErrorMessage('Geolocation is not available in this browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyDriverLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        setLocationStatus('Location permission needed');
        setErrorMessage('Location permission is required to receive emergency missions.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      },
    );
  }, []);

  useEffect(() => {
    if (!driverLocation || !mapContainerRef.current || mapRef.current) return undefined;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [driverLocation.lng, driverLocation.lat],
      zoom: 14,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

    driverMarkerRef.current = new mapboxgl.Marker({ element: createDriverMarker(), anchor: 'center' })
      .setLngLat([driverLocation.lng, driverLocation.lat])
      .addTo(map);

    mapRef.current = map;

    return () => {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
      driverMarkerRef.current?.remove();
      pickupMarkerRef.current?.remove();
      hospitalMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
      pickupMarkerRef.current = null;
      hospitalMarkerRef.current = null;
    };
  }, [driverLocation]);

  useEffect(() => {
    if (!driverLocation || !mapRef.current || !driverMarkerRef.current) return;

    const nextLngLat = [driverLocation.lng, driverLocation.lat];
    driverMarkerRef.current.setLngLat(nextLngLat);

    if (!activeMission) {
      mapRef.current.easeTo({
        center: nextLngLat,
        duration: 500,
        zoom: 14,
      });
    }
  }, [activeMission, driverLocation]);

  useEffect(() => {
    let isMounted = true;

    async function fetchPendingMission() {
      const { data, error } = await supabase
        .from('active_missions')
        .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
        .eq('status', 'pending')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!isMounted || error || !data || activeMission) return;
      setPendingMission(normalizeMission(data));
    }

    fetchPendingMission();

    const missionChannel = supabase
      .channel('driver-pending-missions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'active_missions',
        },
        async (payload) => {
          const mission = payload.new;
          if (!mission || activeMission) return;

          if (mission.status === 'pending') {
            const { data } = await supabase
              .from('active_missions')
              .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
              .eq('id', mission.id)
              .maybeSingle();
            setPendingMission(normalizeMission(data || mission));
            return;
          }

          if (pendingMission?.id === mission.id && mission.status !== 'pending') {
            setPendingMission(null);
          }
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(missionChannel);
    };
  }, [activeMission, pendingMission?.id]);

  const upsertLineLayer = ({ id, coordinates, color }) => {
    if (!mapRef.current || coordinates.length < 2) return;

    const routeGeoJSON = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates,
      },
    };

    const sourceId = `${id}-source`;
    const layerId = `${id}-line`;

    if (mapRef.current.getSource(sourceId)) {
      mapRef.current.getSource(sourceId).setData(routeGeoJSON);
      return;
    }

    mapRef.current.addSource(sourceId, {
      type: 'geojson',
      data: routeGeoJSON,
    });
    mapRef.current.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': color,
        'line-opacity': 0.9,
        'line-width': 6,
      },
    });
  };

  const drawRoute = (coordinates, pickupIndex) => {
    if (!mapRef.current || coordinates.length < 2) return;

    const addOrUpdateRoute = () => {
      if (!mapRef.current) return;

      upsertLineLayer({
        id: 'driver-route-patient',
        coordinates: coordinates.slice(0, pickupIndex + 1),
        color: '#2563eb',
      });
      upsertLineLayer({
        id: 'driver-route-hospital',
        coordinates: coordinates.slice(pickupIndex),
        color: '#22c55e',
      });

      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach((coord) => bounds.extend(coord));
      mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15 });
    };

    if (mapRef.current.loaded()) {
      addOrUpdateRoute();
    } else {
      mapRef.current.once('load', addOrUpdateRoute);
    }
  };

  const fetchSignalsForPreemption = async () => {
    const { data, error } = await supabase
      .from('traffic_signals')
      .select('id, name, lat, lng, status, queue_length, preemption_mode')
      .not('osm_ref', 'is', null);

    if (error) {
      setErrorMessage(error.message || 'Unable to load signal geofences.');
      return [];
    }

    return data || [];
  };

  const triggerPreemption = async (mission, signal, distanceMeters) => {
    if (!mission?.id || !signal?.id || triggeredSignalsRef.current.has(signal.id)) return;

    triggeredSignalsRef.current.add(signal.id);

    const eventNumber = triggeredSignalsRef.current.size;
    const aiFails = Number(signal.queue_length || 0) >= 35 || eventNumber % 4 === 0;
    const result = aiFails ? 'failed' : 'success';

    const signalUpdate = aiFails
      ? {
          preemption_mode: 'failed',
          active_mission_id: mission.id,
          last_preempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : {
          status: 'green',
          preemption_mode: 'ai_active',
          active_mission_id: mission.id,
          last_preempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

    await supabase.from('traffic_signals').update(signalUpdate).eq('id', signal.id);
    await supabase.from('preemption_events').insert({
      mission_id: mission.id,
      traffic_signal_id: signal.id,
      trigger_distance_meters: Math.round(distanceMeters),
      requested_by: 'ai',
      result,
    });

    setPreemptionLog((current) => [
      {
        id: `${signal.id}-${Date.now()}`,
        name: signal.name,
        result,
        distanceMeters: Math.round(distanceMeters),
      },
      ...current,
    ].slice(0, 4));
  };

  const startGpsSimulation = (coordinates, mission, pickupIndex, signals) => {
    if (!user || coordinates.length < 2) return;
    if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);

    let index = 0;
    let pickupMarked = false;
    setRouteProgress(0);
    setRoutePhase('to_patient');
    triggeredSignalsRef.current = new Set();

    simulationTimerRef.current = setInterval(async () => {
      const nextCoord = coordinates[index];
      if (!nextCoord) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
        setRouteProgress(100);
        setRoutePhase('completed');
        await supabase
          .from('active_missions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', mission.id);
        return;
      }

      const nextLocation = {
        lng: nextCoord[0],
        lat: nextCoord[1],
      };

      setDriverLocation(nextLocation);
      setRouteProgress(Math.round(((index + 1) / coordinates.length) * 100));

      if (!pickupMarked && index >= pickupIndex) {
        pickupMarked = true;
        setRoutePhase('to_hospital');
        await supabase
          .from('active_missions')
          .update({
            status: 'en_route_hospital',
            patient_picked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', mission.id);
      }

      await supabase.from('driver_locations').upsert(
        {
          driver_id: user.id,
          lat: nextLocation.lat,
          lng: nextLocation.lng,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'driver_id' },
      );

      await Promise.all(
        signals.map(async (signal) => {
          const distanceMeters = distance(
            point([nextLocation.lng, nextLocation.lat]),
            point([signal.lng, signal.lat]),
            { units: 'kilometers' },
          ) * 1000;

          if (distanceMeters <= SIGNAL_GEOFENCE_METERS) {
            await triggerPreemption(mission, signal, distanceMeters);
          }
        }),
      );

      index += 1;
    }, SIMULATION_TICK_MS);
  };

  const buildRouteAndStartDriving = async (mission) => {
    if (!driverLocation) {
      setErrorMessage('Driver location is not ready yet.');
      return;
    }

    if (!mission.hospital) {
      setErrorMessage('Mission is missing a destination hospital.');
      return;
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${driverLocation.lng},${driverLocation.lat};${mission.pickup_lng},${mission.pickup_lat};${mission.hospital.lng},${mission.hospital.lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || !data.routes?.[0]?.geometry?.coordinates?.length) {
      throw new Error(data.message || 'Unable to calculate route to patient and hospital.');
    }

    const rawCoordinates = data.routes[0].geometry.coordinates;
    const rawPickupIndex = findClosestCoordinateIndex(rawCoordinates, {
      lat: mission.pickup_lat,
      lng: mission.pickup_lng,
    });
    const { coordinates, pickupIndex } = buildSimulationRoute(rawCoordinates, rawPickupIndex);
    const signals = await fetchSignalsForPreemption();

    await supabase
      .from('active_missions')
      .update({
        route_coordinates: coordinates,
        route_pickup_index: pickupIndex,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mission.id);

    drawRoute(coordinates, pickupIndex);

    if (mapRef.current) {
      if (pickupMarkerRef.current) pickupMarkerRef.current.remove();
      pickupMarkerRef.current = new mapboxgl.Marker({ element: createPickupMarker(), anchor: 'center' })
        .setLngLat([mission.pickup_lng, mission.pickup_lat])
        .addTo(mapRef.current);

      if (hospitalMarkerRef.current) hospitalMarkerRef.current.remove();
      hospitalMarkerRef.current = new mapboxgl.Marker({ element: createHospitalMarker(), anchor: 'center' })
        .setLngLat([mission.hospital.lng, mission.hospital.lat])
        .addTo(mapRef.current);
    }

    startGpsSimulation(coordinates, mission, pickupIndex, signals);
  };

  const handleAcceptMission = async () => {
    if (!user || !pendingMission || !driverLocation || isAccepting) return;

    setErrorMessage('');
    setIsAccepting(true);

    const { data, error } = await supabase
      .from('active_missions')
      .update({
        status: 'accepted',
        driver_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pendingMission.id)
      .eq('status', 'pending')
      .select('id, patient_id, driver_id, hospital_id, pickup_lat, pickup_lng, status, hospitals(id, name, lat, lng, trauma_level)')
      .single();

    if (error) {
      setErrorMessage(error.message || 'Unable to accept mission.');
      setIsAccepting(false);
      return;
    }

    const acceptedMission = normalizeMission(data);
    setPendingMission(null);
    setActiveMission(acceptedMission);

    try {
      await buildRouteAndStartDriving(acceptedMission);
    } catch (routeError) {
      setErrorMessage(routeError.message || 'Mission accepted, but route generation failed.');
    } finally {
      setIsAccepting(false);
    }
  };

  const missionDistance = formatDistanceKm(driverLocation, pendingMission);
  const missionDestination = activeMission?.hospital || pendingMission?.hospital;

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      {!driverLocation && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950 text-center">
          <div className="flex max-w-xs flex-col items-center gap-4 px-6">
            <Loader2 className="h-10 w-10 animate-spin text-blue-300" />
            <div>
              <p className="text-lg font-bold">{locationStatus}</p>
              <p className="mt-2 text-sm text-slate-400">Driver GPS is required before accepting missions.</p>
            </div>
            <button
              type="button"
              onClick={() => applyDriverLocation(TEST_DRIVER_LOCATION, 'Using test ambulance location')}
              className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-100 active:scale-[0.99]"
            >
              Use Test Location
            </button>
          </div>
        </div>
      )}

      <div className="absolute left-4 right-4 top-4 z-20 flex items-center justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Driver Mode</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <Crosshair className="h-4 w-4 text-blue-300" />
            {activeMission ? 'Mission active' : locationStatus}
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

      {pendingMission && !activeMission && driverLocation && (
        <section className="absolute inset-x-4 top-1/2 z-30 -translate-y-1/2 rounded-3xl border border-red-300/30 bg-red-950/95 p-5 text-center shadow-2xl shadow-red-950/60 backdrop-blur">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-red-500 text-white shadow-xl shadow-red-950/40">
            <Siren className="h-9 w-9" />
          </div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-red-200">Emergency Request</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-white">
            Request at {missionDistance}
          </h1>
          <p className="mt-3 text-sm font-medium text-red-100">
            Pickup is locked. Destination: {pendingMission.hospital?.name || 'selected emergency hospital'}.
          </p>

          <button
            type="button"
            onClick={handleAcceptMission}
            disabled={isAccepting || !driverLocation}
            className="mt-5 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 text-lg font-black uppercase tracking-wide text-red-700 shadow-xl transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAccepting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Truck className="h-7 w-7" />}
            Accept Mission
          </button>
        </section>
      )}

      <section className="absolute bottom-0 left-0 right-0 z-20 max-h-[62vh] overflow-y-auto rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
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

          {missionDestination && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm font-semibold text-emerald-100">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-200">Destination Hospital</p>
                <p className="mt-1 text-white">{missionDestination.name}</p>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100">
              {errorMessage}
            </div>
          )}

          {activeMission && (
            <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-blue-100">
                <span>Route simulation</span>
                <span>{routeProgress}%</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${routeProgress}%` }} />
              </div>
            </div>
          )}

          {preemptionLog.length > 0 && (
            <div className="mt-4 grid gap-2">
              {preemptionLog.map((event) => (
                <div
                  key={event.id}
                  className={`flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold ${
                    event.result === 'success'
                      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                      : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                  }`}
                >
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p>{event.result === 'success' ? 'AI preemption active' : 'AI failed, police override needed'}</p>
                    <p className="mt-1 text-xs opacity-80">{event.name} at {event.distanceMeters} m</p>
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
