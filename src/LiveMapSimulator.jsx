import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Target, MapPin, Search, Activity, Loader2 } from 'lucide-react';
import distance from '@turf/distance';
import length from '@turf/length';
import along from '@turf/along';
import bearing from '@turf/bearing';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import { point, lineString } from '@turf/helpers';

const ANIMATION_SPEED_MULTIPLIER = 1.5; // 1 = base speed, 2 = 2x faster
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

mapboxgl.accessToken = MAPBOX_TOKEN || '';

const LiveMapSimulator = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const hospitalMarker = useRef(null);
  
  const [emergencyCoord, setEmergencyCoord] = useState(null);
  const [hospitalOptions, setHospitalOptions] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [isSearchingHospital, setIsSearchingHospital] = useState(false);
  const [calculationError, setCalculationError] = useState(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);
  const [drivingDistance, setDrivingDistance] = useState(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [ambulanceCoords, setAmbulanceCoords] = useState(null);
  const [simulationStatus, setSimulationStatus] = useState('idle'); // 'idle' | 'running' | 'completed'

  // A/B Simulation States
  const [aiMode, setAiMode] = useState(false);
  const [trafficLights, setTrafficLights] = useState([]);
  const [missionLogs, setMissionLogs] = useState([]);
  const [missionTimerMs, setMissionTimerMs] = useState(0); 
  const [completionStats, setCompletionStats] = useState(null);
  const [missionHistory, setMissionHistory] = useState([]);

  const ambulanceMarker = useRef(null);
  const animationRef = useRef(null);
  const missionTimerRef = useRef(null);
  const trafficMarkerRefs = useRef({});
  const queueMarkerRefs = useRef({});
  const savedLightQueues = useRef([]);  // Keeps queue counts across resets for A/B

  // Crash-proof distance helper
  const safeDistToSignal = (ambCoords, signalCoords) => {
    if (!ambCoords || !signalCoords) return 9999;
    try {
      return distance(point(ambCoords), point(signalCoords), { units: 'kilometers' });
    } catch (e) {
      return 9999;
    }
  };

  // Render tiny car SVGs behind a signal marker.
  // FIX #3: When isGreen is true, immediately remove all car icons (no ghost cars).
  const renderTrafficQueue = (count, signalCoord, lightId, isGreen = false) => {
    // Always remove old queue markers for this light first
    if (queueMarkerRefs.current[lightId]) {
      queueMarkerRefs.current[lightId].forEach(m => m.remove());
    }
    queueMarkerRefs.current[lightId] = [];

    // FIX #3: If signal is GREEN, remove cars entirely — do NOT render.
    if (!map.current || count === 0 || isGreen) return;

    const carsToShow = Math.min(count, 20); // Cap visual at 20 cars
    for (let i = 0; i < carsToShow; i++) {
      const carEl = document.createElement('div');
      carEl.style.width = '10px';
      carEl.style.height = '6px';
      carEl.style.borderRadius = '2px';
      carEl.style.border = '1px solid rgba(255,255,255,0.3)';
      const severity = count > 30 ? '#ef4444' : count > 10 ? '#f59e0b' : '#10b981';
      carEl.style.backgroundColor = severity;
      carEl.style.opacity = '0.8';

      // Offset each car slightly along the route behind the signal
      const offset = (i + 1) * 0.00008;
      const carCoord = [signalCoord[0] - offset, signalCoord[1] + (i % 2 === 0 ? 0.00003 : -0.00003)];

      const carMarker = new mapboxgl.Marker({ element: carEl })
        .setLngLat(carCoord)
        .addTo(map.current);
      queueMarkerRefs.current[lightId].push(carMarker);
    }
  };

  // New Effect perfectly tying React State explicitly to the physical Dispatch marker
  useEffect(() => {
    if (!ambulanceCoords || !map.current) return;
    
    if (!ambulanceMarker.current) {
        const ambEl = document.createElement('div');
        ambEl.className = 'ambulance-marker';
        ambEl.style.backgroundColor = '#ef4444'; // Red circle
        ambEl.style.width = '24px';
        ambEl.style.height = '24px';
        ambEl.style.borderRadius = '50%';
        ambEl.style.border = '4px solid white';
        ambEl.style.boxShadow = '0 0 20px rgba(239, 68, 68, 1)';
        ambEl.style.zIndex = '999';
        ambEl.style.display = 'flex';
        ambEl.style.alignItems = 'center';
        ambEl.style.justifyContent = 'center';

        const cross = document.createElement('div');
        cross.style.backgroundColor = 'white';
        cross.style.width = '12px';
        cross.style.height = '4px';

        const cross2 = document.createElement('div');
        cross2.style.backgroundColor = 'white';
        cross2.style.width = '4px';
        cross2.style.height = '12px';
        cross2.style.position = 'absolute';

        ambEl.appendChild(cross);
        ambEl.appendChild(cross2);
        
        ambulanceMarker.current = new mapboxgl.Marker({ element: ambEl })
          .setLngLat(ambulanceCoords)
          .addTo(map.current);
    } else {
        ambulanceMarker.current.setLngLat(ambulanceCoords);
    }
  }, [ambulanceCoords]);

  // Sync Traffic Lights UX on Map
  useEffect(() => {
    if (!map.current) return;
    
    // Clear old markers
    Object.values(trafficMarkerRefs.current).forEach(m => m.remove());
    trafficMarkerRefs.current = {};

    trafficLights.forEach(light => {
       const wrapper = document.createElement('div');
       wrapper.className = 'traffic-node-container';
       wrapper.style.display = 'flex';
       wrapper.style.flexDirection = 'column';
       wrapper.style.alignItems = 'center';
       wrapper.style.gap = '4px';
       
       // Top Badge Tooltip
       const badge = document.createElement('div');
       let badgeColor = '#10b981'; // Green
       if (light.queue > 10 && light.queue <= 30) badgeColor = '#f59e0b'; // Amber
       if (light.queue > 30) badgeColor = '#ef4444'; // Red
       badge.style.backgroundColor = badgeColor;
       badge.style.color = 'white';
       badge.style.padding = '2px 6px';
       badge.style.borderRadius = '4px';
       badge.style.fontSize = '10px';
       badge.style.fontWeight = 'bold';
       badge.style.boxShadow = `0 0 10px ${badgeColor}80`;
       badge.innerText = `${light.queue} cars`;
       
       // Core Light Circle
       const el = document.createElement('div');
       el.style.width = '24px';
       el.style.height = '24px';
       el.style.borderRadius = '50%';
       el.style.border = '3px solid #1e293b';
       const color = light.isGreen ? '#10b981' : '#ef4444';
       el.style.backgroundColor = color;
       el.style.boxShadow = `0 0 15px ${color}`;
       el.style.display = 'flex';
       el.style.alignItems = 'center';
       el.style.justifyContent = 'center';
       el.style.color = '#fff';
       el.style.fontWeight = 'bold';
       el.style.fontSize = '10px';
       el.innerText = `L${light.id}`;
       
       wrapper.appendChild(badge);
       wrapper.appendChild(el);

       const marker = new mapboxgl.Marker({ element: wrapper })
         .setLngLat(light.coord)
         .addTo(map.current);
       
       trafficMarkerRefs.current[light.id] = marker;

       // Render visual car queue behind this signal (pass isGreen for clearing effect)
       renderTrafficQueue(light.queue, light.coord, light.id, light.isGreen);
    });
  }, [trafficLights]);

  useEffect(() => {
    if (map.current) return; // initialize map only once

    if (!MAPBOX_TOKEN) {
      setCalculationError('Missing VITE_MAPBOX_TOKEN. Add it to your Vercel environment variables.');
      return;
    }
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [78.4772, 17.4065], // Lng, Lat for Hyderabad
      zoom: 11
    });

    map.current.on('click', (e) => {
      const { lng, lat } = e.lngLat;
      setEmergencyCoord({ lng: lng.toFixed(5), lat: lat.toFixed(5) });

      // Remove existing marker if there is one
      if (marker.current) {
        marker.current.remove();
      }

      // Add a red mapbox marker
      marker.current = new mapboxgl.Marker({ color: '#ef4444' })
        .setLngLat([lng, lat])
        .addTo(map.current);

      // --- Step 2: Find Nearest Hospital ---
      if (hospitalMarker.current) {
        hospitalMarker.current.remove();
        hospitalMarker.current = null;
      }
      
      // Remove existing route if any
      if (map.current.getSource('route')) {
        map.current.removeLayer('route');
        map.current.removeSource('route');
      }
      
      setHospitalOptions([]);
      setSelectedHospital(null);
      setRouteGeoJSON(null);
      setDrivingDistance(null);
      setIsDispatching(false);
      setAmbulanceCoords(null);
      setCalculationError(null);
      setIsSearchingHospital(true);
      
      setTrafficLights([]);
      setMissionLogs([]);
      setMissionTimerMs(0);
      setCompletionStats(null);
      if (missionTimerRef.current) clearInterval(missionTimerRef.current);

      if (ambulanceMarker.current) {
        ambulanceMarker.current.remove();
        ambulanceMarker.current = null;
      }
      if (animationRef.current) clearInterval(animationRef.current);

      const query = `[out:json]; nwr["amenity"="hospital"](around:20000, ${lat}, ${lng}); out center;`;
      const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

      fetch(overpassUrl)
        .then(res => res.json())
        .then(data => {
          try {
            if (data.elements && data.elements.length > 0) {
              
              // 1. Aggressive Data Filtering
              const validHospitals = data.elements.filter(el => {
                 if (!el.tags || !el.tags.name) return false;
                 
                 const name = el.tags.name.toLowerCase();
                 const junkTokens = ['clinic', 'ayurved', 'dental', 'eye', 'homeo', 'vet', 'skin', 'physio', 'care', 'scan'];
                 
                 // If name includes any junk token, exclude it
                 for (let token of junkTokens) {
                   if (name.includes(token)) return false;
                 }
                 return true; 
              });

              // 2. Safe Map and measure distances perfectly using Turf.js
              const patientPoint = point([Number(lng), Number(lat)]); // strict [longitude, latitude]
              const hospitalsWithDistance = validHospitals.map(el => {
                const targetLat = el.center?.lat || el.lat;
                const targetLng = el.center?.lon || el.lon;
                
                // The Bouncer: Strict validation to prevent Turf.js crashes
                if (!targetLat || !targetLng || isNaN(targetLat) || isNaN(targetLng)) {
                  return null;
                }
                
                const hospitalPoint = point([Number(targetLng), Number(targetLat)]); // strict [longitude, latitude]
                const dist = distance(patientPoint, hospitalPoint, { units: 'meters' });
                return {
                  lat: targetLat,
                  lon: targetLng,
                  name: el.tags.name,
                  dist: dist
                };
              }).filter(h => h !== null);

              // 3. Exact Mathematical Sort (Shortest Distance to Longest)
              hospitalsWithDistance.sort((a, b) => a.dist - b.dist);
              
              // 4. Slice to Top 10 array
              const top10Hospitals = hospitalsWithDistance.slice(0, 10);
              if (top10Hospitals.length > 0) {
                console.log("Top 10 Sanitized Hospitals:", top10Hospitals);
                setHospitalOptions(top10Hospitals);
              } else {
                throw new Error("No hospitals found from API");
              }
            } else {
              throw new Error("Empty elements array");
            }
          } catch (err) {
            console.error("Error processing hospitals, using fallback:", err);
            generateFallbackHospitals(lat, lng);
          }
        })
        .catch(err => {
          console.error("Overpass API fetch error, using fallback:", err);
          generateFallbackHospitals(lat, lng);
        })
        .finally(() => setIsSearchingHospital(false));
      
      const generateFallbackHospitals = (emergLat, emergLng) => {
          const latNum = Number(emergLat);
          const lngNum = Number(emergLng);
          const pt = point([lngNum, latNum]);
          
          const fallbackHospitals = [
            { name: "City Central Emergency", lat: latNum + 0.015, lon: lngNum + 0.012 },
            { name: "Metro Medical Center", lat: latNum - 0.010, lon: lngNum + 0.025 },
            { name: "Regional Trauma Unit", lat: latNum - 0.020, lon: lngNum - 0.015 },
            { name: "Apollo General Clinic", lat: latNum + 0.025, lon: lngNum - 0.010 }
          ];

          const mappedFallback = fallbackHospitals.map(h => {
             const hPt = point([h.lon, h.lat]);
             h.dist = distance(pt, hPt, { units: 'meters' });
             return h;
          }).sort((a, b) => a.dist - b.dist);

          setHospitalOptions(mappedFallback);
      };
    });

    return () => {
      if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
      if (missionTimerRef.current) { clearInterval(missionTimerRef.current); missionTimerRef.current = null; }
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
      Object.values(trafficMarkerRefs.current).forEach(m => m.remove());
      Object.values(queueMarkerRefs.current).forEach(arr => arr.forEach(m => m.remove()));
    };
  }, []);

  const handleHospitalSelect = (hospital) => {
    setSelectedHospital(hospital);

    // Drop blue pin
    if (hospitalMarker.current) {
      hospitalMarker.current.remove();
    }
    hospitalMarker.current = new mapboxgl.Marker({ color: '#3b82f6' })
      .setLngLat([hospital.lon, hospital.lat])
      .addTo(map.current);

    // Mapbox Directions API for routing (Hospital -> Emergency Point)
    if (emergencyCoord) {
      const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${hospital.lon},${hospital.lat};${emergencyCoord.lng},${emergencyCoord.lat}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
      
      fetch(directionsUrl)
        .then(res => res.json())
        .then(data => {
          if (data.routes && data.routes[0]) {
            const routeJSON = data.routes[0].geometry;
            const actualDist = data.routes[0].distance / 1000; // in km
            
            setRouteGeoJSON(routeJSON);
            setDrivingDistance(actualDist);
            
            // Fetch real signals using bounding box from route coordinates
            const routeLine = lineString(routeJSON.coordinates);
            const routeLen = length(routeJSON, { units: 'kilometers' });
            
            // Build bounding box from all route coordinates
            let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
            routeJSON.coordinates.forEach(([lng, lat]) => {
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
              if (lng < minLng) minLng = lng;
              if (lng > maxLng) maxLng = lng;
            });
            // Add small padding to bounding box
            const pad = 0.002;
            const bbox = `${minLat - pad},${minLng - pad},${maxLat + pad},${maxLng + pad}`;
            
            const signalQuery = `[out:json];node["highway"="traffic_signals"](${bbox});out;`;
            const signalUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(signalQuery)}`;
            
            const buildFallbackSignals = (dist) => {
              const l1 = along(routeJSON, dist * 0.3, { units: 'kilometers' }).geometry.coordinates;
              const l2 = along(routeJSON, dist * 0.6, { units: 'kilometers' }).geometry.coordinates;
              const l3 = along(routeJSON, dist * 0.9, { units: 'kilometers' }).geometry.coordinates;
              return [
                { id: 1, coord: l1, distanceAlong: dist * 0.3, queue: Math.floor(Math.random() * 51), isGreen: false, hasPredicted: false, notifiedStop: false, clearTimeMs: 0 },
                { id: 2, coord: l2, distanceAlong: dist * 0.6, queue: Math.floor(Math.random() * 51), isGreen: false, hasPredicted: false, notifiedStop: false, clearTimeMs: 0 },
                { id: 3, coord: l3, distanceAlong: dist * 0.9, queue: Math.floor(Math.random() * 51), isGreen: false, hasPredicted: false, notifiedStop: false, clearTimeMs: 0 }
              ];
            };
            
            fetch(signalUrl)
              .then(r => r.json())
              .then(signalData => {
                if (!signalData.elements || signalData.elements.length === 0) {
                  console.log('[SIGNAL] No real signals found. Using 30/60/90 fallback.');
                  const fb = buildFallbackSignals(actualDist);
                  savedLightQueues.current = fb.map(l => l.queue);
                  setTrafficLights(fb);
                  return;
                }
                
                // Snap real signals onto route line
                const snapped = signalData.elements
                  .map(el => {
                    if (!el.lat || !el.lon || isNaN(el.lat) || isNaN(el.lon)) return null;
                    try {
                      const snappedPt = nearestPointOnLine(routeLine, point([el.lon, el.lat]));
                      const snapDist = snappedPt.properties.dist; // distance from line in km
                      if (snapDist > 0.15) return null; // Must be within 150m of route
                      const distAlong = snappedPt.properties.location; // km along line
                      if (distAlong < routeLen * 0.1 || distAlong > routeLen * 0.95) return null;
                      return {
                        coord: snappedPt.geometry.coordinates,
                        distanceAlong: distAlong
                      };
                    } catch(e) { return null; }
                  })
                  .filter(s => s !== null)
                  .sort((a, b) => a.distanceAlong - b.distanceAlong);
                
                // FIX #2: Deduplicate signals too close together (< 0.3km apart) using a Set on rounded coords
                const seenCoords = new Set();
                let realSignals = [];
                for (let i = 0; i < snapped.length; i++) {
                  const coordKey = `${snapped[i].coord[0].toFixed(4)},${snapped[i].coord[1].toFixed(4)}`;
                  if (seenCoords.has(coordKey)) continue;
                  if (realSignals.length === 0 || snapped[i].distanceAlong - realSignals[realSignals.length - 1].distanceAlong > 0.3) {
                    seenCoords.add(coordKey);
                    realSignals.push(snapped[i]);
                  }
                  if (realSignals.length >= 3) break;
                }

                let finalSignals;
                // FIX #2: Only use fallback when ZERO real signals found.
                // If even 1 real signal exists, never show simulated ones.
                if (realSignals.length >= 1) {
                  console.log(`[SIGNAL] Using ${realSignals.length} real traffic signals on route`);
                  finalSignals = realSignals.slice(0, 3).map((s, idx) => ({
                    id: idx + 1,
                    coord: s.coord,
                    distanceAlong: s.distanceAlong,
                    queue: Math.floor(Math.random() * 51),
                    isGreen: false, hasPredicted: false, notifiedStop: false, clearTimeMs: 0
                  }));
                } else {
                  // Strictly 0 real signals — use simulated fallback
                  console.log('[SIGNAL] Fallback: 0 real signals found. Using simulated positions.');
                  finalSignals = buildFallbackSignals(actualDist);
                }
                
                savedLightQueues.current = finalSignals.map(l => l.queue);
                setTrafficLights(finalSignals);
              })
              .catch(() => {
                const fb = buildFallbackSignals(actualDist);
                savedLightQueues.current = fb.map(l => l.queue);
                setTrafficLights(fb);
              });
            
            if (map.current.getSource('route')) {
              map.current.getSource('route').setData(routeJSON);
            } else {
              map.current.addSource('route', {
                type: 'geojson',
                data: routeJSON
              });
              map.current.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                  'line-join': 'round',
                  'line-cap': 'round'
                },
                paint: {
                  'line-color': '#0ea5e9',
                  'line-width': 5,
                  'line-opacity': 0.8
                }
              });
            }
            
            // Adjust bounds to fit the route
            const bounds = new mapboxgl.LngLatBounds();
            routeJSON.coordinates.forEach(coord => bounds.extend(coord));
            map.current.fitBounds(bounds, { padding: 80 });
          }
        })
        .catch(err => console.error("Directions API Error:", err));
    }
  };

  // Reset simulation for A/B retesting on the same route
  const resetSimulation = () => {
    // Use same hard reset helper for consistency
    if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    if (missionTimerRef.current) { clearInterval(missionTimerRef.current); missionTimerRef.current = null; }

    if (ambulanceMarker.current) {
      ambulanceMarker.current.remove();
      ambulanceMarker.current = null;
    }

    setIsDispatching(false);
    setSimulationStatus('idle');
    setMissionTimerMs(0);
    setMissionLogs([]);
    setCompletionStats(null);
    setAmbulanceCoords(null);

    // Reset traffic lights to red with SAME queues (for A/B fairness)
    setTrafficLights(prev => prev.map((light, idx) => ({
      ...light,
      isGreen: false,
      hasPredicted: false,
      notifiedStop: false,
      clearTimeMs: 0,
      queue: savedLightQueues.current[idx] ?? light.queue
    })));
  };

  // ── FIX #1: Hard Reset before a new dispatch run ────────────────────────
  const hardReset = () => {
    if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    if (missionTimerRef.current) { clearInterval(missionTimerRef.current); missionTimerRef.current = null; }
    if (ambulanceMarker.current) { ambulanceMarker.current.remove(); ambulanceMarker.current = null; }
    setAmbulanceCoords(null);
    setMissionTimerMs(0);
    setMissionLogs([]);
    setCompletionStats(null);
    setIsDispatching(false);
    setSimulationStatus('idle');
  };

  const startDispatchAnimation = () => {
    if (!routeGeoJSON || !routeGeoJSON.coordinates || routeGeoJSON.coordinates.length < 2) return;

    // FIX #1: Hard Reset ghost state from previous run
    hardReset();

    // FIX #4: Confirm routeLine is valid before entering loop
    const routeLine = lineString(routeGeoJSON.coordinates);
    if (!routeLine || routeLine.geometry.coordinates.length < 2) {
      console.error('[DISPATCH] Invalid routeLine — aborting.');
      return;
    }

    setIsDispatching(true);
    setSimulationStatus('running');
    setMissionLogs([`[INIT] Dispatching unit from Hospital (${aiMode ? 'AI MODE' : 'STANDARD MODE'})...`]);

    // Jump to the start coordinate
    setAmbulanceCoords(routeGeoJSON.coordinates[0]);

    const routeDistance = length(routeGeoJSON, { units: 'kilometers' });
    let currentDistance = 0;
    // FIX #5: Use ANIMATION_SPEED_MULTIPLIER to tune speed without breaking math
    const baseSpeed = (routeDistance / 100) * ANIMATION_SPEED_MULTIPLIER;

    // FIX #5: missionTimer now lives inside the rAF loop — starts exactly when
    // the ambulance moves and stops the exact frame it hits the destination.
    const missionStartTime = Date.now();

    let activeLights = [...trafficLights];

    // ── FIX #4: Use requestAnimationFrame instead of setInterval ─────────────
    const FRAME_INTERVAL_MS = 50; // ~20fps for animation ticks
    let lastFrameTime = null;
    let accumulatedMs = 0;

    const tick = async (timestamp) => {
      // FIX #4: Guard — bail if routeLine becomes invalid
      if (!routeLine || routeLine.geometry.coordinates.length < 2) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
        return;
      }

      // Throttle to ~50ms steps for stable physics
      if (lastFrameTime === null) lastFrameTime = timestamp;
      accumulatedMs += timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      if (accumulatedMs < FRAME_INTERVAL_MS) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }
      accumulatedMs -= FRAME_INTERVAL_MS;

      // FIX #5: Update timer every frame — synced to animation
      setMissionTimerMs(Date.now() - missionStartTime);

      let currentSpeed = baseSpeed;
      const elapsedMs = Date.now() - missionStartTime;

      // Find upcoming light
      const upcomingLightIndex = activeLights.findIndex(l => l.distanceAlong >= currentDistance);
      if (upcomingLightIndex !== -1) {
        const upcomingLight = activeLights[upcomingLightIndex];
        const distToLight = upcomingLight.distanceAlong - currentDistance;

        if (aiMode) {
          if (distToLight < 0.5 && !upcomingLight.hasPredicted) {
            upcomingLight.hasPredicted = true;
            setMissionLogs(prev => [...prev, `[AI] Junction L${upcomingLight.id}: ${upcomingLight.queue} vehicles detected. Intercepting API...`]);

            try {
              const response = await fetch('http://127.0.0.1:8000/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ev_distance: Math.round(distToLight * 1000), sv_queue: upcomingLight.queue })
              });
              if (response.ok) {
                const json = await response.json();
                if (json.action_name && (json.action_name.includes('Green') || json.action_name.includes('Pre-Emptive') || json.action_name.includes('Predictive'))) {
                  upcomingLight.isGreen = true;
                  setTrafficLights([...activeLights]);
                  setMissionLogs(prev => [...prev, `[AI] Junction L${upcomingLight.id} Action: Emergency Override (${json.action_name})`]);
                } else {
                  setMissionLogs(prev => [...prev, `[AI] Junction L${upcomingLight.id} Action: Standard Check (${json.action_name})`]);
                }
              }
            } catch (err) {
              setMissionLogs(prev => [...prev, `[ERROR] AI Connectivity lost.`]);
            }
          }
        } else {
          // Standard Mode: 8s red / 8s green rotation
          const isStandardGreen = (elapsedMs % 16000) > 8000;
          if (isStandardGreen !== upcomingLight.isGreen) {
            upcomingLight.isGreen = isStandardGreen;
            setTrafficLights([...activeLights]);
          }
        }

        // Physical stopping mechanics
        if (distToLight < 0.05) {
          let shouldStop = false;

          if (aiMode) {
            shouldStop = !upcomingLight.isGreen;
            if (shouldStop && !upcomingLight.notifiedStop) {
              upcomingLight.notifiedStop = true;
              setMissionLogs(prev => [...prev, `[STOP] Ambulance stuck at RED light L${upcomingLight.id}`]);
            }
          } else {
            if (!upcomingLight.isGreen) {
              shouldStop = true;
            } else {
              if (!upcomingLight.clearTimeMs) {
                upcomingLight.clearTimeMs = elapsedMs + (Math.floor(upcomingLight.queue / 5) * 1000);
              }
              if (elapsedMs < upcomingLight.clearTimeMs) {
                shouldStop = true;
              }
            }

            if (shouldStop && !upcomingLight.notifiedStop) {
              upcomingLight.notifiedStop = true;
              const delaySecs = Math.floor(upcomingLight.queue / 5);
              setMissionLogs(prev => [...prev, `[STOP] Junction L${upcomingLight.id}: Queue block (${upcomingLight.queue} cars). Wait penalty ${delaySecs}s activated.`]);
            }
            if (!shouldStop && upcomingLight.notifiedStop && upcomingLight.clearTimeMs > 0 && elapsedMs >= upcomingLight.clearTimeMs) {
              upcomingLight.clearTimeMs = -1;
              setMissionLogs(prev => [...prev, `[SUCCESS] Junction L${upcomingLight.id} queue safely cleared. Resuming.`]);
            }
          }

          if (shouldStop) currentSpeed = 0;
        }
      }

      currentDistance += currentSpeed;

      // FIX #4: Destination check — use cancelAnimationFrame to stop cleanly
      if (currentDistance >= routeDistance) {
        // Snap to final coord — no out-of-bounds turf calculation
        const finalCoord = routeGeoJSON.coordinates[routeGeoJSON.coordinates.length - 1];
        setAmbulanceCoords(finalCoord);

        // FIX #5: Stop timer exactly on final frame
        const finalTimeMs = Date.now() - missionStartTime;
        setMissionTimerMs(finalTimeMs);

        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
        if (missionTimerRef.current) { clearInterval(missionTimerRef.current); missionTimerRef.current = null; }

        setIsDispatching(false);
        setSimulationStatus('completed');
        const finalTime = finalTimeMs / 1000;
        setMissionLogs(prev => [...prev, `[SUCCESS] Arrived at patient in ${finalTime.toFixed(1)}s`]);

        const totalQueuePenalty = activeLights.reduce((sum, l) => sum + Math.floor(l.queue / 5), 0);
        const standardEstimate = aiMode ? (finalTime + totalQueuePenalty + 8 * activeLights.length) : finalTime;
        const aiEstimate = aiMode ? finalTime : Math.max(finalTime - totalQueuePenalty - 8 * activeLights.length, finalTime * 0.5);

        const stats = {
          mode: aiMode ? 'AI PREEMPTION' : 'STANDARD TIMERS',
          actual: finalTime.toFixed(2),
          standardTime: standardEstimate.toFixed(2),
          aiTime: aiEstimate.toFixed(2),
          savedPercent: aiMode
            ? ((1 - finalTime / standardEstimate) * 100).toFixed(0)
            : ((1 - aiEstimate / finalTime) * 100).toFixed(0)
        };
        setCompletionStats(stats);
        setMissionHistory(prev => [...prev, stats]);
        return; // exit tick — do NOT schedule next frame
      }

      // FIX #4: Guard against NaN — must be within valid range
      const prevDist = Math.max(0, currentDistance - currentSpeed);
      const clampedDist = Math.min(currentDistance, routeDistance);

      let point1, point2;
      try {
        point1 = along(routeGeoJSON, prevDist, { units: 'kilometers' }).geometry.coordinates;
        point2 = along(routeGeoJSON, clampedDist, { units: 'kilometers' }).geometry.coordinates;
      } catch (e) {
        // If turf throws (shouldn't happen with clamped values), skip this frame
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      const calcBearing = bearing(point(point1), point(point2));
      setAmbulanceCoords(point2);

      const el = document.querySelector('.ambulance-marker');
      if (el && currentSpeed > 0) {
        el.style.transform = `rotate(${calcBearing + 90}deg)`;
      }

      // Schedule next frame
      animationRef.current = requestAnimationFrame(tick);
    };

    // Kick off the animation loop
    animationRef.current = requestAnimationFrame(tick);
  };

  return (
    <div className="relative w-full h-[calc(100vh-64px)] overflow-hidden">
      {/* Sleek UI Overlay Panel */}
      <div className="absolute top-6 left-6 z-10 w-96 glass-panel p-6 border border-slate-700/50 shadow-[0_10px_40px_rgba(0,0,0,0.5)] bg-slate-900/85 backdrop-blur-xl rounded-3xl flex flex-col gap-6 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-500/20 rounded-lg border border-rose-500/30">
              <Target className="w-6 h-6 text-rose-500" />
            </div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-rose-400 to-red-500 bg-clip-text text-transparent">
              Auto Dispatch
            </h2>
          </div>
          
          <button 
             onClick={() => simulationStatus !== 'running' && setAiMode(!aiMode)}
             className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all text-xs font-bold ${aiMode ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-slate-800 border-slate-600 text-slate-400'} ${simulationStatus === 'running' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-700'}`}
          >
             <div className={`w-2 h-2 rounded-full ${aiMode ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></div>
             AI MODE: {aiMode ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700/50 shadow-inner">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-4">Emergency Coordinates</p>
            
            {emergencyCoord ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <MapPin className="w-6 h-6 text-rose-500" />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-slate-400 font-medium">Lat: <span className="text-slate-100 font-mono tracking-wider">{emergencyCoord.lat}</span></span>
                    <span className="text-sm text-slate-400 font-medium">Lng: <span className="text-slate-100 font-mono tracking-wider">{emergencyCoord.lng}</span></span>
                  </div>
                </div>
                <div className="mt-2 py-2 px-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 text-sm text-emerald-400 font-medium flex items-center gap-3">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_5px_#10b981]"></div>
                  Locked. Ready for routing.
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 gap-3 text-slate-300">
                <Search className="w-8 h-8 text-slate-500 animate-pulse" />
                <span className="italic text-sm font-light text-slate-400">Awaiting Emergency Coordinates...</span>
              </div>
            )}
          </div>
          
          {/* Dispatcher Selection Display */}
          <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700/50 shadow-inner max-h-[350px] overflow-y-auto">
            <p className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-4 sticky top-0 bg-slate-800/95 pb-2 pt-1 z-10 -mt-1 backdrop-blur-sm">Available Hospitals</p>
            
            {isSearchingHospital ? (
              <div className="flex items-center gap-3 text-blue-400 py-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-medium">Scanning 20km radius...</span>
              </div>
            ) : calculationError ? (
              <div className="text-sm text-red-500 italic py-2">{calculationError}</div>
            ) : hospitalOptions.length > 0 ? (
              <div className="flex flex-col gap-3">
                {hospitalOptions.map((hospital, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleHospitalSelect(hospital)}
                    className={`flex items-center justify-between w-full p-3 rounded-xl border transition-all duration-300 text-left ${selectedHospital === hospital ? 'bg-blue-500/20 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'bg-slate-900/50 border-slate-700 hover:border-slate-500 hover:bg-slate-800'}`}
                  >
                    <div className="flex items-center gap-3 flex-1 overflow-hidden">
                      <div className={`p-1.5 rounded-lg shrink-0 ${selectedHospital === hospital ? 'bg-blue-500' : 'bg-slate-700'}`}>
                        <Activity className={`w-4 h-4 ${selectedHospital === hospital ? 'text-white' : 'text-slate-300'}`} />
                      </div>
                      <div className="flex flex-col flex-1 overflow-hidden">
                        <span className="text-sm font-bold text-slate-200 truncate pr-2">{hospital.name}</span>
                        <span className="text-xs text-slate-400 truncate">Lat/Lng: {Number(hospital.lat).toFixed(4)}...</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-2">
                       <span className="text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20 whitespace-nowrap">
                         {(hospital.dist / 1000).toFixed(1)} km
                       </span>
                       <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">(Straight-line)</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : emergencyCoord ? (
              <div className="text-sm text-slate-500 italic py-2">No qualified hospitals found within 20km search radius.</div>
            ) : (
              <div className="flex items-center gap-3 text-slate-500 py-3">
                 <span className="italic text-sm font-light">Awaiting incident...</span>
              </div>
            )}

            {routeGeoJSON && (
               <div className="mt-4 pt-3 border-t border-slate-700/50">
                  <div className="flex justify-between items-center mb-3 pb-1">
                     <span className="text-xs font-bold text-slate-300">Driving Distance</span>
                     <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]">{drivingDistance?.toFixed(2)} km</span>
                  </div>
                  
                  {simulationStatus === 'idle' && (
                    <button 
                       onClick={startDispatchAnimation}
                       className="w-full py-2.5 rounded-xl font-bold uppercase tracking-wider text-xs transition-all duration-300 shadow-[0_0_20px_rgba(239,68,68,0.3)] flex justify-center bg-red-600 hover:bg-red-500 text-white hover:shadow-[0_0_30px_rgba(239,68,68,0.5)]"
                    >
                       Start Dispatch ({aiMode ? 'AI Mode' : 'Standard Mode'})
                    </button>
                  )}
                  
                  {simulationStatus === 'running' && (
                    <div className="w-full py-2.5 rounded-xl font-bold uppercase tracking-wider text-xs bg-amber-600/30 border border-amber-500/50 text-amber-400 flex justify-center items-center gap-2">
                       <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                       En Route...
                    </div>
                  )}
                  
                  {simulationStatus === 'completed' && (
                    <button 
                       onClick={resetSimulation}
                       className="w-full py-2.5 rounded-xl font-bold uppercase tracking-wider text-xs transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.3)] flex justify-center bg-blue-600 hover:bg-blue-500 text-white hover:shadow-[0_0_30px_rgba(59,130,246,0.5)]"
                    >
                       Reset & Re-Run ({aiMode ? 'AI Mode' : 'Standard Mode'})
                    </button>
                  )}
               </div>
            )}

            {(simulationStatus === 'running' || simulationStatus === 'completed') && (
               <div className="mt-3 pt-3 border-t border-slate-700/50 flex flex-col gap-2">
                  <div className="flex justify-between items-center bg-slate-900/80 p-3 rounded-lg border border-slate-700">
                      <span className="text-xs font-bold text-slate-400 tracking-widest uppercase">Mission Timer</span>
                      <span className={`text-xl font-mono font-bold ${simulationStatus === 'completed' ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                          {(missionTimerMs / 1000).toFixed(1)}s
                      </span>
                  </div>
                  
                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-700 h-[120px] overflow-y-auto flex flex-col gap-1 text-[10px] font-mono shadow-inner custom-scrollbar">
                      {missionLogs.map((log, i) => (
                           <div key={i} className={`leading-relaxed break-words ${log.includes('[ERROR]') ? 'text-rose-400' : log.includes('[SUCCESS]') || log.includes('GREEN') || log.includes('Override') ? 'text-emerald-400 shadow-[0_0_5px_rgba(16,185,129,0.3)] font-bold' : log.includes('[STOP]') ? 'text-yellow-400 font-bold' : log.includes('[AI]') ? 'text-cyan-400' : 'text-slate-300'}`}>
                               {log}
                           </div>
                      ))}
                      {simulationStatus === 'running' && <div className="text-slate-500 animate-pulse mt-1">_</div>}
                  </div>
               </div>
            )}

            {completionStats && (
                <div className="mt-3 bg-slate-800 p-3 rounded-xl border border-emerald-500/30 flex flex-col gap-2 relative overflow-hidden shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                    <div className="absolute -top-2 -right-4 p-2 opacity-[0.03]">
                        <Target className="w-24 h-24 text-emerald-500" />
                    </div>
                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest text-center">Simulation Complete</p>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                         <div className="flex flex-col p-2 bg-emerald-900/30 rounded border border-emerald-700/50 z-10">
                             <span className="text-[9px] text-emerald-400 uppercase font-bold">AI Time</span>
                             <span className="text-base font-bold text-emerald-300">{completionStats.aiTime}s</span>
                         </div>
                         <div className="flex flex-col p-2 bg-rose-900/30 rounded border border-rose-700/50 z-10">
                             <span className="text-[9px] text-rose-400 uppercase font-bold">Standard Time</span>
                             <span className="text-base font-bold text-rose-300">{completionStats.standardTime}s</span>
                         </div>
                    </div>
                    <div className="text-center text-[10px] font-bold mt-1 z-10">
                        <span className="text-emerald-400">~{completionStats.savedPercent}% faster with AI</span>
                        <span className="text-slate-500 ml-2">({completionStats.mode})</span>
                    </div>
                </div>
            )}

            {missionHistory.length > 1 && (
                <div className="mt-3 bg-slate-800/80 p-3 rounded-xl border border-slate-700/50">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Mission History</p>
                    <div className="flex flex-col gap-1.5">
                        {missionHistory.map((run, i) => (
                            <div key={i} className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-700/50 text-[10px]">
                                <span className={`font-bold ${run.mode.includes('AI') ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    Run {i + 1}: {run.mode}
                                </span>
                                <div className="flex gap-3">
                                    <span className="text-emerald-300">AI: {run.aiTime}s</span>
                                    <span className="text-rose-300">STD: {run.standardTime}s</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
          </div>
        </div>
      </div>

      {/* Mapbox Container */}
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
};

export default LiveMapSimulator;
