import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = useCallback(async (currentUser) => {
    if (!currentUser) {
      setRole(null);
      return null;
    }

    try {
      const { data: idMatch, error: idError } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (idError) {
        throw idError;
      }

      if (idMatch?.role) {
        setRole(idMatch.role);
        return idMatch.role;
      }

      const { data: emailMatch, error: emailError } = await supabase
        .from('users')
        .select('role')
        .eq('email', currentUser.email)
        .maybeSingle();

      if (emailError) {
        throw emailError;
      }

      setRole(emailMatch?.role ?? null);
      return emailMatch?.role ?? null;
    } catch (error) {
      console.error('Unable to fetch user role:', error);
      setRole(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initializeSession() {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) {
        setSession(null);
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      const activeSession = data.session;
      setSession(activeSession);
      setUser(activeSession?.user ?? null);

      try {
        await fetchUserRole(activeSession?.user ?? null);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, activeSession) => {
      if (!isMounted) return;

      setSession(activeSession);
      setUser(activeSession?.user ?? null);

      if (!activeSession?.user) {
        setRole(null);
        setLoading(false);
        return;
      }

      setRole(null);
      setLoading(false);

      setTimeout(() => {
        if (isMounted) {
          fetchUserRole(activeSession.user);
        }
      }, 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserRole]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user,
      role,
      loading,
      fetchUserRole,
      signOut,
    }),
    [fetchUserRole, loading, role, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }

  return context;
}
