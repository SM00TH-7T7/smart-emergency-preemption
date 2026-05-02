import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { supabase } from './supabaseClient';

const roleRoutes = {
  patient: '/patient-dash',
  driver: '/driver-dash',
  police: '/police-dash',
};

const withTimeout = (promise, timeoutMs, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);

export default function Login() {
  const navigate = useNavigate();
  const { fetchUserRole, loading, role, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!loading && user && roleRoutes[role]) {
      navigate(roleRoutes[role], { replace: true });
    }
  }, [loading, navigate, role, user]);

  if (!loading && user && roleRoutes[role]) {
    return <Navigate to={roleRoutes[role]} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        15000,
        'Sign in timed out. Please check your network and try again.',
      );

      if (error) {
        throw error;
      }

      const nextRole = await fetchUserRole(data.user);
      if (!roleRoutes[nextRole]) {
        setErrorMessage('Signed in, but no app role was found for this account.');
        return;
      }

      navigate(roleRoutes[nextRole], { replace: true });
    } catch (error) {
      setErrorMessage(error.message || 'Unable to sign in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10">
            <ShieldCheck className="h-7 w-7 text-cyan-300" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Smart Corridor</p>
            <h1 className="text-2xl font-bold text-white">Emergency Access</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/30">
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-semibold text-slate-200">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="h-14 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-base text-white outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-semibold text-slate-200">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="h-14 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-base text-white outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10"
              placeholder="Enter password"
            />
          </div>

          {errorMessage && (
            <div className="flex gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
              <span>{errorMessage}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 text-base font-bold text-slate-950 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Activity className="h-5 w-5" />}
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
