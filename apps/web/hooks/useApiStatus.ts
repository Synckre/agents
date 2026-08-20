'use client';

import { useEffect, useState } from 'react';

export type ApiStatus = 'checking' | 'online' | 'offline';

/**
 * Monitorea la salud del API Synckre (healthcheck cada 30s).
 */
export function useApiStatus(intervalMs = 30000): ApiStatus {
  const [status, setStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('http://localhost:8000/api/v1/health', {
          signal: controller.signal,
          headers: { 'x-api-key': 'synckre-int-key-2026' },
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => null);
        if (!cancelled) setStatus(data?.status === 'healthy' ? 'online' : 'offline');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    };
    ping();
    const interval = setInterval(ping, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs]);

  return status;
}
