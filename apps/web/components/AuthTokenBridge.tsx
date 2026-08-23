'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { setApiTokenProvider } from '@/lib/api';

/** Conecta Clerk useAuth().getToken con el cliente API (sin window.Clerk). */
export function AuthTokenBridge() {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    setApiTokenProvider(() => getToken());
    return () => setApiTokenProvider(null);
  }, [getToken, isLoaded]);

  return null;
}
