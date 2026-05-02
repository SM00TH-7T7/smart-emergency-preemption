import React from 'react';
import { Navigate, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { LogOut, Shield } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import DriverDashboard from './DriverDashboard';
import Login from './Login';
import PatientDashboard from './PatientDashboard';
import PoliceDashboard from './PoliceDashboard';

const roleRoutes = {
  patient: '/patient-dash',
  driver: '/driver-dash',
  police: '/police-dash',
};

const roleLabels = {
  patient: 'Patient',
  driver: 'Driver',
  police: 'Police',
};

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-4">
        <div className="h-3 w-3 animate-pulse rounded-full bg-cyan-300" />
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Loading</span>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { loading, role, user } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || !roleRoutes[role]) return <Navigate to="/login" replace />;

  return <Navigate to={roleRoutes[role]} replace />;
}

function ProtectedRoute({ allowedRole, children }) {
  const { loading, role, user } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user || role !== allowedRole) return <Navigate to="/login" replace />;

  return children;
}

function RoleDashboard({ role }) {
  const { signOut, user } = useAuth();
  const label = roleLabels[role];

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col">
        <header className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10">
              <Shield className="h-6 w-6 text-cyan-300" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">{user?.email}</p>
              <h1 className="text-2xl font-bold text-white">Welcome {label}</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-200 transition active:scale-95"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </header>
      </div>
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/patient-dash"
        element={
          <ProtectedRoute allowedRole="patient">
            <PatientDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/driver-dash"
        element={
          <ProtectedRoute allowedRole="driver">
            <DriverDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/police-dash"
        element={
          <ProtectedRoute allowedRole="police">
            <PoliceDashboard />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
