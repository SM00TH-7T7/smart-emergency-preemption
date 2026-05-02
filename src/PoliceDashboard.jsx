import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { Activity, AlertTriangle, LogOut, RadioTower, ShieldCheck, Siren, Zap } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const CITY_CENTER = [78.4772, 17.4065];
const ROUTE_LOOK_BEHIND_POINTS = 12;
const ROUTE_LOOK_AHEAD_POINTS = 30;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

function normalizeStatus(status) {
  return String(status || 'red').toLowerCase() === 'green' ? 'green' : 'red';
}

function createAmbulanceMarker() {
  const marker = document.createElement('div');
  marker.className = 'police-ambulance-marker';
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
      font-weight: 900;
      box-shadow: 0 12px 32px rgba(127, 29, 29, 0.55);
    ">+</div>
  `;
  return marker;
}

function createSignalMarker(signal) {
  const status = normalizeStatus(signal.status);
  const mode = signal.preemption_mode || 'normal';
  const color = mode === 'failed' ? '#f59e0b' : status === 'green' ? '#22c55e' : '#ef4444';
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'traffic-signal-marker';
  marker.setAttribute('aria-label', `${signal.name} traffic signal`);
  marker.style.width = '30px';
  marker.style.height = '30px';
  marker.style.borderRadius = '9999px';
  marker.style.border = '4px solid white';
  marker.style.background = color;
  marker.style.boxShadow = `0 0 0 7px ${
    mode === 'failed'
      ? 'rgba(245, 158, 11, 0.28)'
      : status === 'green'
        ? 'rgba(34, 197, 94, 0.22)'
        : 'rgba(239, 68, 68, 0.22)'
  }, 0 12px 28px rgba(15, 23, 42, 0.35)`;
  marker.style.cursor = 'pointer';
  marker.style.padding = '0';
  return marker;
}

function isRealSignal(signal) {
  return Boolean(signal?.osm_ref);
}

function findClosestCoordinateIndex(coordinates, location) {
  if (!coordinates?.length || !location) return -1;

  return coordinates.reduce(
    (best, coordinate, index) => {
      const km = distance(point(coordinate), point([location.lng, location.lat]), { units: 'kilometers' });
      return km < best.km ? { index, km } : best;
    },
    { index: -1, km: Number.POSITIVE_INFINITY },
  ).index;
}

function formatPreemptionMode(mode) {
  if (mode === 'ai_active') return 'AI ACTIVE';
  if (mode === 'manual_override') return 'MANUAL OVERRIDE';
  if (mode === 'failed') return 'AI FAILED';
  return 'NORMAL';
}

function createSignalPopupContent(signal, onQueueChange, onManualOverride) {
  const status = normalizeStatus(signal.status);
  const mode = signal.preemption_mode || 'normal';
  const wrapper = document.createElement('div');
  wrapper.style.width = '240px';
  wrapper.style.color = '#0f172a';
  wrapper.innerHTML = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b;">Intersection</p>
      <h3 style="margin: 0; font-size: 17px; line-height: 1.2; color: #0f172a;">${signal.name}</h3>
      <div style="margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #334155;">Current status</span>
        <span style="border-radius: 9999px; padding: 4px 9px; font-size: 12px; font-weight: 900; color: white; background: ${status === 'green' ? '#16a34a' : '#dc2626'};">${status.toUpperCase()}</span>
      </div>
      <div style="margin-top: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #334155;">Preemption</span>
        <span style="border-radius: 9999px; padding: 4px 9px; font-size: 12px; font-weight: 900; color: white; background: ${mode === 'failed' ? '#d97706' : mode === 'normal' ? '#475569' : '#2563eb'};">${formatPreemptionMode(mode)}</span>
      </div>
      <p style="margin: 8px 0 0; font-size: 12px; color: #64748b;">OpenStreetMap ${signal.osm_ref}</p>
      <label for="signal-queue-${signal.id}" style="display: block; margin-top: 14px; font-size: 13px; font-weight: 800; color: #334155;">
        Traffic Queue Simulation
      </label>
      <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
        <input id="signal-queue-${signal.id}" type="range" min="0" max="50" value="${signal.queue_length ?? 0}" style="width: 100%;" />
        <strong id="signal-queue-value-${signal.id}" style="min-width: 28px; text-align: right; color: #0f172a;">${signal.queue_length ?? 0}</strong>
      </div>
      <p style="margin: 8px 0 0; font-size: 12px; color: #64748b;">0 to 50 cars</p>
      <button id="signal-override-${signal.id}" type="button" style="margin-top: 14px; width: 100%; min-height: 42px; border: 0; border-radius: 14px; background: #dc2626; color: white; font-size: 13px; font-weight: 900; cursor: pointer;">
        OVERRIDE TO GREEN
      </button>
    </div>
  `;

  const slider = wrapper.querySelector(`#signal-queue-${CSS.escape(signal.id)}`);
  const valueLabel = wrapper.querySelector(`#signal-queue-value-${CSS.escape(signal.id)}`);
  const overrideButton = wrapper.querySelector(`#signal-override-${CSS.escape(signal.id)}`);

  slider.addEventListener('input', (event) => {
    valueLabel.textContent = event.target.value;
  });

  slider.addEventListener('change', (event) => {
    onQueueChange(signal.id, Number(event.target.value));
  });

  overrideButton.addEventListener('click', () => {
    onManualOverride(signal);
  });

  return wrapper;
}

export default function PoliceDashboard() {
  const { signOut } = useAuth();
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const ambulanceMarkersRef = useRef(new Map());
  const signalMarkersRef = useRef(new Map());
  const signalPopupsRef = useRef(new Map());
  const driverLocationsRef = useRef(new Map());
  const activeMissionsRef = useRef(new Map());

  const [ambulanceCount, setAmbulanceCount] = useState(0);
  const [signalCount, setSignalCount] = useState(0);
  const [routeCount, setRouteCount] = useState(0);
  const [preemptionEvents, setPreemptionEvents] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setErrorMessage('Missing VITE_MAPBOX_TOKEN.');
      return undefined;
    }

    if (!mapContainerRef.current || mapRef.current) return undefined;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: CITY_CENTER,
      zoom: 11.5,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    mapRef.current = map;

    return () => {
      ambulanceMarkersRef.current.forEach((marker) => marker.remove());
      signalMarkersRef.current.forEach((marker) => marker.remove());
      signalPopupsRef.current.forEach((popup) => popup.remove());
      ambulanceMarkersRef.current.clear();
      signalMarkersRef.current.clear();
      signalPopupsRef.current.clear();
      driverLocationsRef.current.clear();
      activeMissionsRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const upsertNearbyRoute = (mission) => {
    if (!mapRef.current || !mission?.id || !mission?.driver_id || !Array.isArray(mission.route_coordinates)) return;
    if (!mapRef.current.loaded()) {
      mapRef.current.once('load', () => upsertNearbyRoute(mission));
      return;
    }

    const driverLocation = driverLocationsRef.current.get(mission.driver_id);
    if (!driverLocation) return;

    const nearestIndex = findClosestCoordinateIndex(mission.route_coordinates, driverLocation);
    if (nearestIndex < 0) return;

    const routeSegment = mission.route_coordinates.slice(
      Math.max(0, nearestIndex - ROUTE_LOOK_BEHIND_POINTS),
      Math.min(mission.route_coordinates.length, nearestIndex + ROUTE_LOOK_AHEAD_POINTS),
    );

    if (routeSegment.length < 2) return;

    const sourceId = `police-route-${mission.id}`;
    const layerId = `${sourceId}-line`;
    const routeGeoJSON = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: routeSegment,
      },
    };

    if (mapRef.current.getSource(sourceId)) {
      mapRef.current.getSource(sourceId).setData(routeGeoJSON);
    } else {
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
          'line-color': '#f97316',
          'line-opacity': 0.92,
          'line-width': 7,
        },
      });
    }
  };

  const removeNearbyRoute = (missionId) => {
    if (!mapRef.current || !missionId || !mapRef.current.loaded()) return;

    const sourceId = `police-route-${missionId}`;
    const layerId = `${sourceId}-line`;

    if (mapRef.current.getLayer(layerId)) {
      mapRef.current.removeLayer(layerId);
    }
    if (mapRef.current.getSource(sourceId)) {
      mapRef.current.removeSource(sourceId);
    }
  };

  const refreshNearbyRoutes = () => {
    activeMissionsRef.current.forEach((mission) => {
      upsertNearbyRoute(mission);
    });
    setRouteCount(activeMissionsRef.current.size);
  };

  const upsertAmbulanceMarker = (location) => {
    if (!mapRef.current || !location?.driver_id || location.lat == null || location.lng == null) return;

    const lngLat = [location.lng, location.lat];
    driverLocationsRef.current.set(location.driver_id, { lat: location.lat, lng: location.lng });
    const existing = ambulanceMarkersRef.current.get(location.driver_id);

    if (existing) {
      existing.setLngLat(lngLat);
      refreshNearbyRoutes();
      return;
    }

    const marker = new mapboxgl.Marker({ element: createAmbulanceMarker(), anchor: 'center' })
      .setLngLat(lngLat)
      .addTo(mapRef.current);

    ambulanceMarkersRef.current.set(location.driver_id, marker);
    setAmbulanceCount(ambulanceMarkersRef.current.size);
    refreshNearbyRoutes();
  };

  const removeAmbulanceMarker = (driverId) => {
    const marker = ambulanceMarkersRef.current.get(driverId);
    if (!marker) return;
    marker.remove();
    ambulanceMarkersRef.current.delete(driverId);
    driverLocationsRef.current.delete(driverId);
    setAmbulanceCount(ambulanceMarkersRef.current.size);
  };

  const updateSignalQueue = async (signalId, queueLength) => {
    const boundedQueue = Math.max(0, Math.min(50, queueLength));
    const { error } = await supabase
      .from('traffic_signals')
      .update({
        queue_length: boundedQueue,
        updated_at: new Date().toISOString(),
      })
      .eq('id', signalId);

    if (error) {
      setErrorMessage(error.message || 'Unable to update traffic queue.');
    }
  };

  const overrideSignal = async ({ signalId, missionId }) => {
    if (!signalId) return;

    const nextTimestamp = new Date().toISOString();
    const { error } = await supabase
      .from('traffic_signals')
      .update({
        status: 'green',
        preemption_mode: 'manual_override',
        last_preempted_at: nextTimestamp,
        updated_at: nextTimestamp,
      })
      .eq('id', signalId);

    if (error) {
      setErrorMessage(error.message || 'Unable to override traffic signal.');
      return;
    }

    if (missionId) {
      await supabase.from('preemption_events').insert({
        mission_id: missionId,
        traffic_signal_id: signalId,
        trigger_distance_meters: 0,
        requested_by: 'police',
        result: 'manual_override',
      });
    }
  };

  const handleManualOverride = async (signal) => {
    await overrideSignal({
      signalId: signal?.id,
      missionId: signal?.active_mission_id,
    });
  };

  const upsertSignalMarker = (signal) => {
    if (!mapRef.current || !signal?.id || signal.lat == null || signal.lng == null) return;

    if (!isRealSignal(signal)) {
      removeSignalMarker(signal.id);
      return;
    }

    const existing = signalMarkersRef.current.get(signal.id);
    if (existing) existing.remove();

    const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true, offset: 18 }).setDOMContent(
      createSignalPopupContent(signal, updateSignalQueue, handleManualOverride),
    );

    const marker = new mapboxgl.Marker({ element: createSignalMarker(signal), anchor: 'center' })
      .setLngLat([signal.lng, signal.lat])
      .setPopup(popup)
      .addTo(mapRef.current);

    signalMarkersRef.current.set(signal.id, marker);
    signalPopupsRef.current.set(signal.id, popup);
    setSignalCount(signalMarkersRef.current.size);
  };

  const removeSignalMarker = (signalId) => {
    const marker = signalMarkersRef.current.get(signalId);
    const popup = signalPopupsRef.current.get(signalId);
    if (marker) marker.remove();
    if (popup) popup.remove();
    signalMarkersRef.current.delete(signalId);
    signalPopupsRef.current.delete(signalId);
    setSignalCount(signalMarkersRef.current.size);
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchAmbulances() {
      const { data, error } = await supabase
        .from('driver_locations')
        .select('driver_id, lat, lng, updated_at');

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message || 'Unable to load ambulance locations.');
        return;
      }

      data?.forEach(upsertAmbulanceMarker);
    }

    fetchAmbulances();

    const channel = supabase
      .channel('police-driver-locations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_locations',
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            removeAmbulanceMarker(payload.old?.driver_id);
            return;
          }

          upsertAmbulanceMarker(payload.new);
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchActiveMissionRoutes() {
      const { data, error } = await supabase
        .from('active_missions')
        .select('id, driver_id, status, route_coordinates, route_pickup_index, updated_at')
        .in('status', ['accepted', 'en_route_hospital']);

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message || 'Unable to load ambulance routes.');
        return;
      }

      activeMissionsRef.current.clear();
      data?.forEach((mission) => {
        if (mission.driver_id && Array.isArray(mission.route_coordinates)) {
          activeMissionsRef.current.set(mission.id, mission);
        }
      });
      refreshNearbyRoutes();
    }

    fetchActiveMissionRoutes();

    const channel = supabase
      .channel('police-active-mission-routes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'active_missions',
        },
        async (payload) => {
          const mission = payload.new;

          if (!mission || !['accepted', 'en_route_hospital'].includes(mission.status)) {
            if (payload.old?.id) {
              activeMissionsRef.current.delete(payload.old.id);
              removeNearbyRoute(payload.old.id);
            }
            refreshNearbyRoutes();
            return;
          }

          const { data } = await supabase
            .from('active_missions')
            .select('id, driver_id, status, route_coordinates, route_pickup_index, updated_at')
            .eq('id', mission.id)
            .maybeSingle();

          if (data?.driver_id && Array.isArray(data.route_coordinates)) {
            activeMissionsRef.current.set(data.id, data);
          }
          refreshNearbyRoutes();
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchSignals() {
      const { data, error } = await supabase
        .from('traffic_signals')
        .select('id, osm_ref, name, lat, lng, status, queue_length, preemption_mode, active_mission_id, last_preempted_at, updated_at')
        .not('osm_ref', 'is', null)
        .order('name', { ascending: true });

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message || 'Unable to load traffic signals.');
        return;
      }

      data?.forEach(upsertSignalMarker);
    }

    fetchSignals();

    const channel = supabase
      .channel('police-traffic-signals')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'traffic_signals',
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            removeSignalMarker(payload.old?.id);
            return;
          }

          if (!isRealSignal(payload.new)) {
            removeSignalMarker(payload.new?.id);
            return;
          }

          upsertSignalMarker(payload.new);
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchPreemptionEvents() {
      const { data, error } = await supabase
        .from('preemption_events')
        .select('id, mission_id, traffic_signal_id, trigger_distance_meters, requested_by, result, created_at, traffic_signals(name)')
        .order('created_at', { ascending: false })
        .limit(6);

      if (!isMounted) return;
      if (error) {
        setErrorMessage(error.message || 'Unable to load preemption events.');
        return;
      }

      setPreemptionEvents(data || []);
    }

    fetchPreemptionEvents();

    const channel = supabase
      .channel('police-preemption-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'preemption_events',
        },
        async () => {
          await fetchPreemptionEvents();
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const latestPreemption = preemptionEvents[0];
  const latestFailedPreemption = preemptionEvents.find((event) => event.result === 'failed');
  const failedPreemptions = preemptionEvents.filter((event) => event.result === 'failed').length;

  return (
    <main className="relative h-screen w-full overflow-hidden bg-slate-950 text-white">
      <div ref={mapContainerRef} className="h-screen w-full" />

      <div className="absolute left-4 right-4 top-4 z-20 flex items-start justify-between gap-3">
        <div className="rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Police Command</p>
          <h1 className="mt-1 text-xl font-black text-white">City Emergency Monitor</h1>
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

      <section className="absolute bottom-0 left-0 right-0 z-20 rounded-t-[2rem] border-t border-white/10 bg-slate-950/95 px-5 pb-6 pt-5 shadow-2xl shadow-black/60 backdrop-blur">
        <div className="mx-auto max-w-md">
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
              <p className="mt-2 text-3xl font-black text-white">{failedPreemptions}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3 text-sm font-semibold text-slate-300">
            <RadioTower className="h-5 w-5 shrink-0 text-cyan-300" />
            Showing {routeCount} nearby ambulance route corridor{routeCount === 1 ? '' : 's'}.
          </div>

          {latestPreemption && (
            <div
              className={`mt-3 flex items-start gap-3 rounded-2xl border p-3 text-sm font-semibold ${
                latestPreemption.result === 'failed'
                  ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
                  : latestPreemption.result === 'manual_override'
                    ? 'border-blue-400/30 bg-blue-500/10 text-blue-100'
                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
              }`}
            >
              <Zap className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p>
                  {latestPreemption.result === 'failed'
                    ? 'AI preemption failed'
                    : latestPreemption.result === 'manual_override'
                      ? 'Police override sent'
                      : 'AI preemption active'}
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {latestPreemption.traffic_signals?.name || 'Traffic signal'} - {latestPreemption.trigger_distance_meters} m
                </p>
              </div>
            </div>
          )}

          {latestFailedPreemption && (
            <button
              type="button"
              onClick={() => overrideSignal({
                signalId: latestFailedPreemption.traffic_signal_id,
                missionId: latestFailedPreemption.mission_id,
              })}
              className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-4 text-sm font-black uppercase tracking-wide text-white shadow-xl shadow-red-950/40 active:scale-[0.99]"
            >
              <AlertTriangle className="h-5 w-5" />
              Override Latest Failed Signal
            </button>
          )}

          {errorMessage && (
            <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm font-medium text-red-100">
              {errorMessage}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-500">
            <ShieldCheck className="h-4 w-4" />
            This simulates a signal-controller API by writing live signal states to Supabase.
          </div>
        </div>
      </section>
    </main>
  );
}
