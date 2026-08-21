/**
 * Cliente API para conectar la interfaz de Next.js con la API v1 de Synckre Agent V2.
 *
 * En el navegador se usa same-origin (`/api/v1/...`) para evitar CORS.
 * El route handler `app/api/v1/[...path]` reenvía al backend (API_URL).
 * En servidor se llama directo al backend.
 */

export function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return '';
  }
  return (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(
    /\/$/,
    '',
  );
}

/** En el navegador es always same-origin; en servidor apunta al backend. */
export const API_BASE = getApiBase();

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const headers = {
    ...(options.headers || {}),
  } as Record<string, string>;

  if (!headers['Authorization'] && typeof window !== 'undefined') {
    try {
      const clerk = (window as unknown as { Clerk?: { session?: { getToken?: () => Promise<string | null> } } }).Clerk;
      const token = clerk?.session?.getToken ? await clerk.session.getToken() : null;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // Sin sesión Clerk: las rutas protegidas responderán 401
    }
  }

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${getApiBase()}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: 'Error en la petición API' }));
    const detail = errorData.detail;
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join(' ')
          : `Error HTTP ${response.status}`;
    throw new Error(message || `Error HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getHealth: () => fetchApi('/api/v1/health'),

  // Conversations
  listConversations: () => fetchApi('/api/v1/conversations'),
  createConversation: (role = 'customer_support') =>
    fetchApi('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ role, channel: 'api' }),
    }),
  getConversation: (id: string) => fetchApi(`/api/v1/conversations/${id}`),
  deleteConversation: (id: string) =>
    fetchApi(`/api/v1/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (id: string, message: string, role?: string, asHuman = false) =>
    fetchApi(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, role, as_human: asHuman }),
    }),

  // Tasks
  listTasks: () => fetchApi('/api/v1/tasks'),
  getTask: (id: string) => fetchApi(`/api/v1/tasks/${id}`),
  cancelTask: (id: string, reason?: string) =>
    fetchApi(`/api/v1/tasks/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // Approvals
  listApprovals: (status?: string) =>
    fetchApi(`/api/v1/approvals${status ? `?status=${status}` : ''}`),
  approveRequest: (id: string, approvedBy: string = 'admin', reason?: string, editedValue?: string) =>
    fetchApi(`/api/v1/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved_by: approvedBy, reason, edited_value: editedValue }),
    }),
  rejectRequest: (id: string, approvedBy: string = 'admin', reason?: string) =>
    fetchApi(`/api/v1/approvals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ approved_by: approvedBy, reason }),
    }),

  // Business Entities
  listLeads: () => fetchApi('/api/v1/leads'),
  listContracts: () => fetchApi('/api/v1/contracts'),

  // Knowledge / RAG
  listKnowledge: () => fetchApi('/api/v1/knowledge'),
  ingestDocument: (title: string, domain: string, content: string, filename: string) =>
    fetchApi('/api/v1/knowledge', {
      method: 'POST',
      body: JSON.stringify({ title, domain, content, filename }),
    }),
  uploadKnowledgePdf: (formData: FormData) =>
    fetchApi('/api/v1/knowledge/upload', {
      method: 'POST',
      body: formData,
    }),

  // Audit / Telemetría
  listAuditLogs: () => fetchApi('/api/v1/audit'),
  listToolExecutions: (conversationId?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (conversationId) params.set('conversation_id', conversationId);
    return fetchApi(`/api/v1/audit/tool-executions?${params.toString()}`);
  },

  // Analytics
  getAnalyticsStats: () => fetchApi('/api/v1/analytics/stats'),

  // API Keys
  listApiKeys: () => fetchApi('/api/v1/api-keys'),
  createApiKey: (name: string, role = 'public') =>
    fetchApi('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, role }),
    }),
  revokeApiKey: (id: string) =>
    fetchApi(`/api/v1/api-keys/${id}`, { method: 'DELETE' }),
};
