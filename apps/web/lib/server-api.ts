/**
 * Fetch al Agent Runtime desde Server Components.
 * Usa el JWT de Clerk (auth().getToken), nunca el tokenProvider del cliente.
 */
import { auth } from '@clerk/nextjs/server';

function apiBase(): string {
  return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
}

export async function serverFetch<T = unknown>(path: string): Promise<T | null> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) return null;

  const res = await fetch(`${apiBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export const serverApi = {
  analyticsStats: () => serverFetch<Record<string, number>>('/api/v1/analytics/stats'),
  conversations: () => serverFetch<Array<{ id: string; role: string; updated_at: string }>>('/api/v1/conversations'),
  auditLogs: () => serverFetch<unknown[]>('/api/v1/audit'),
  toolExecutions: (limit = 50) => serverFetch<unknown[]>(`/api/v1/audit/tool-executions?limit=${limit}`),
  tasks: () => serverFetch<unknown[]>('/api/v1/tasks'),
  knowledge: () => serverFetch<unknown[]>('/api/v1/knowledge'),
  apiKeys: () => serverFetch<unknown[]>('/api/v1/api-keys'),
  roles: () => serverFetch<unknown[]>('/api/v1/roles'),
};


