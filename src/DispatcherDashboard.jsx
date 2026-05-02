import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Target, MapPin, Search, Activity, Loader2, AlertTriangle, Building2 } from 'lucide-react';

const DispatcherDashboard = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      if (!token) {
        setError('Mapbox token not configured');
        return;
      }

      mapboxgl.accessToken = token;
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [78.4772, 17.4065],
        zoom: 11
      });

      map.current.on('load', () => {
        setIsLoading(false);
      });

      map.current.on('error', (e) => {
        setError(`Map error: ${e.error.message}`);
      });

      return () => {
        if (map.current) map.current.remove();
      };
    } catch (err) {
      setError(`Initialization error: ${err.message}`);
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-white">
        <div className="bg-red-900/50 border border-red-700 p-6 rounded-lg max-w-md">
          <h2 className="text-xl font-bold text-red-400 mb-2">Error</h2>
          <p className="text-red-200">{error}</p>
          <div className="mt-4 text-sm text-red-300">
            <p><strong>Troubleshooting:</strong></p>
            <ul className="list-disc ml-4 mt-2">
              <li>Ensure VITE_MAPBOX_TOKEN is set in .env.local</li>
              <li>Verify Mapbox account has an active token</li>
              <li>Check browser console for additional errors</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-slate-900 flex">
      {/* Map Container */}
      <div ref={mapContainer} className="flex-1" />
      
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="flex items-center gap-3 bg-slate-900 px-4 py-3 rounded-lg">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            <span className="text-slate-100">Loading dispatch center...</span>
          </div>
        </div>
      )}

      {/* Control Panel */}
      <div className="absolute bottom-6 left-6 w-96 bg-slate-900/95 border border-slate-700/50 rounded-2xl p-6 shadow-lg backdrop-blur-sm max-h-[calc(100vh-48px)] overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-500/20 rounded-lg border border-emerald-500/30">
            <Target className="w-5 h-5 text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-emerald-400">Dispatch Center</h2>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase">Instructions</p>
            <p className="text-sm text-slate-300">Click on the map to set an emergency location and view nearby hospitals for routing.</p>
          </div>

          <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-purple-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase">Signal Operations</p>
            </div>
            <p className="text-sm text-slate-300">Real-time traffic signal states and queue monitoring along the route will appear here during active dispatch.</p>
          </div>

          <div className="p-4 bg-slate-800/60 rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-4 h-4 text-blue-400" />
              <p className="text-xs font-semibold text-slate-400 uppercase">Hospital Routing</p>
            </div>
            <p className="text-sm text-slate-300">Selected hospital information and routing details will be displayed during active missions.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DispatcherDashboard;
