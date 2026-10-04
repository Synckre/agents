import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubspotHttpClient, RateLimiter } from '../src/adapters/crm/hubspot/hubspot-http.client';
import { CrmError } from '../src/core/ports/crm.port';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function buildClient(overrides: Partial<ConstructorParameters<typeof HubspotHttpClient>[0]> = {}) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  const fetchImpl = vi.fn();
  const client = new HubspotHttpClient({
    baseUrl: 'https://api.hubapi.com',
    apiVersion: '2026-09',
    accessToken: 'test-token',
    maxRetries: 3,
    sleep,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return { client, fetchImpl, sleep };
}

describe('HubspotHttpClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('envía el token como Bearer y devuelve el JSON parseado', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(jsonResponse({ id: '123' }));

    const result = await client.get<{ id: string }>('/crm/objects/2026-09/contacts/123');

    expect(result).toEqual({ id: '123' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.hubapi.com/crm/objects/2026-09/contacts/123');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('falla con CRM_NOT_CONFIGURED si falta el token, sin llamar a la red', async () => {
    const { client, fetchImpl } = buildClient({ accessToken: undefined });

    await expect(client.get('/crm/objects/2026-09/contacts')).rejects.toMatchObject({
      code: 'CRM_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reintenta en 429 respetando Retry-After y termina devolviendo la respuesta válida', async () => {
    const { client, fetchImpl, sleep } = buildClient();
    fetchImpl
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errorType: 'RATE_LIMIT', policyName: 'TEN_SECONDLY_ROLLING' }), {
          status: 429,
          headers: { 'Retry-After': '2' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client.get<{ ok: boolean }>('/crm/objects/2026-09/contacts');

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Retry-After en segundos => 2000 ms
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('acota un Retry-After desmesurado para no colgar la conversación', async () => {
    const { client, fetchImpl, sleep } = buildClient();
    fetchImpl
      .mockImplementationOnce(
        async () =>
          // Política diaria: pide 2 horas.
          new Response(JSON.stringify({ errorType: 'RATE_LIMIT', policyName: 'DAILY' }), {
            status: 429,
            headers: { 'Retry-After': '7200' },
          }),
      )
      .mockImplementationOnce(async () => jsonResponse({ ok: true }));

    await client.get('/crm/objects/2026-09/contacts');

    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('aplica backoff exponencial con jitter cuando el 429 no trae Retry-After', async () => {
    const { client, fetchImpl, sleep } = buildClient();
    fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorType: 'RATE_LIMIT' }), { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await client.get('/crm/objects/2026-09/contacts');

    expect(sleep).toHaveBeenCalledTimes(1);
    const waitMs = sleep.mock.calls[0][0] as number;
    // Full jitter sobre base 500ms => entre 250 y 500 ms
    expect(waitMs).toBeGreaterThanOrEqual(250);
    expect(waitMs).toBeLessThanOrEqual(500);
  });

  it('reintenta en 5xx y agota los intentos lanzando CRM_SERVER_ERROR', async () => {
    const { client, fetchImpl } = buildClient({ maxRetries: 2 });
    // Cada intento consume un body nuevo: un Response no es reutilizable.
    fetchImpl.mockImplementation(async () => new Response('boom', { status: 503 }));

    await expect(client.get('/crm/objects/2026-09/contacts')).rejects.toMatchObject({
      code: 'CRM_SERVER_ERROR',
      status: 503,
      retryable: true,
    });
    // 1 intento inicial + 2 reintentos
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('no reintenta en 401 y reporta un mensaje accionable', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const error = await client.get('/crm/objects/2026-09/contacts').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CrmError);
    expect((error as CrmError).code).toBe('CRM_UNAUTHORIZED');
    expect((error as CrmError).message).toContain('Private App token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('extrae los scopes faltantes de un 403', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'error',
          message: 'missing scopes',
          errors: [{ context: { missingScopes: ['crm.objects.contacts.write'] } }],
        }),
        { status: 403 },
      ),
    );

    await expect(client.get('/crm/objects/2026-09/contacts')).rejects.toMatchObject({
      code: 'CRM_FORBIDDEN',
    });
  });

  it('propaga el correlationId de HubSpot para diagnóstico', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'error', message: 'bad property', correlationId: 'corr-123' }),
        { status: 400 },
      ),
    );

    const error = (await client
      .post('/crm/objects/2026-09/contacts', {})
      .catch((e: unknown) => e)) as CrmError;

    expect(error.code).toBe('CRM_VALIDATION_ERROR');
    expect(error.correlationId).toBe('corr-123');
    expect(error.retryable).toBe(false);
  });

  it('normaliza un timeout de red a CRM_TIMEOUT', async () => {
    const { client, fetchImpl } = buildClient({ maxRetries: 0 });
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    fetchImpl.mockRejectedValue(timeoutError);

    await expect(client.get('/crm/objects/2026-09/contacts')).rejects.toMatchObject({
      code: 'CRM_TIMEOUT',
      retryable: true,
    });
  });

  it('normaliza un 200 con cuerpo no parseable en CRM_INVALID_RESPONSE', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));

    await expect(client.get('/crm/objects/2026-09/contacts')).rejects.toMatchObject({
      code: 'CRM_INVALID_RESPONSE',
      retryable: false,
    });
  });

  it('mapea un 409 a CRM_CONFLICT y no lo reintenta', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Contact already exists' }), { status: 409 }),
    );

    await expect(
      client.post('/crm/objects/2026-09/contacts', {}),
    ).rejects.toMatchObject({ code: 'CRM_CONFLICT', retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('detecta un duplicado señalado con 400 en lugar de 409', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'error',
          category: 'VALIDATION_ERROR',
          errors: [{ code: 'CONTACT_EXISTS', message: 'Existing contact' }],
        }),
        { status: 400 },
      ),
    );

    await expect(
      client.post('/crm/objects/2026-09/contacts', {}),
    ).rejects.toMatchObject({ code: 'CRM_CONFLICT' });
  });

  it('devuelve undefined en 204 sin intentar parsear JSON', async () => {
    const { client, fetchImpl } = buildClient();
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(client.delete('/crm/objects/2026-09/contacts/1')).resolves.toBeUndefined();
  });

  it('cuenta las búsquedas también en el cupo general de la cuenta', async () => {
    // El techo real de HubSpot es único por cuenta (~100 req/10 s): una búsqueda
    // no puede gastar solo su cubo propio y saltarse el general.
    const sleep = vi.fn().mockResolvedValue(undefined);
    let nowMs = 0;
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));

    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 't',
      maxRequestsPerTenSeconds: 2,
      maxSearchRequestsPerSecond: 100,
      sleep,
      now: () => nowMs,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });
    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });
    // Tercera búsqueda: el cubo general (2/10s) está agotado, así que debe esperar.
    nowMs = 1000;
    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });

    expect(sleep).toHaveBeenCalled();
  });

  it('usa el presupuesto de búsqueda para las peticiones marcadas como search', async () => {
    // Ventana de 200ms con temporizador real: la tercera petición debe esperar
    // a que caduque el cupo de 2 en lugar de dispararse en paralelo.
    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 't',
      maxSearchRequestsPerSecond: 2,
      maxRequestsPerTenSeconds: 100,
      fetchImpl: (async () => jsonResponse({ results: [] })) as unknown as typeof fetch,
    });

    const startedAt = Date.now();
    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });
    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });
    await client.post('/crm/objects/2026-09/contacts/search', {}, { search: true });

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });
});

describe('RateLimiter', () => {
  it('permite hasta el cupo y espera la ventana antes de liberar', async () => {
    let nowMs = 0;
    const sleep = vi.fn(async (ms: number) => {
      // Avanza el reloj simulado: en producción lo hace el tiempo real.
      nowMs += ms;
    });
    const limiter = new RateLimiter(2, 1000, () => nowMs, sleep);

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.pending).toBe(2);

    nowMs = 100;
    await limiter.acquire();
    expect(sleep).toHaveBeenCalledWith(900);
    expect(limiter.pending).toBe(1);
  });
});
