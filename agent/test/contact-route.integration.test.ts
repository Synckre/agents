import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { startChatboxServer } from '@adapters/http/chatbox-server';
import { ProcessWebsiteContactUseCase } from '@core/use-cases/process-website-contact.use-case';
import { HubspotCrmAdapter } from '@adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotHttpClient } from '@adapters/crm/hubspot/hubspot-http.client';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IExecuteConversationUseCase } from '@core/ports/execute-conversation.port';
import { FakeHubspotServer } from './helpers/fake-hubspot-server';

const SITE_KEY = 'site-key-for-test';
const ORIGIN = 'https://www.synckre.example';

/**
 * `FakeHubspotServer.install()` reemplaza `globalThis.fetch`, que es también el
 * cliente con el que este test llama al servidor del chatbox. Se guarda la
 * implementación original ANTES de instalar el simulador: si no, las peticiones
 * HTTP del test acaban en el simulador de HubSpot y no en el servidor real.
 */
const httpFetch = globalThis.fetch.bind(globalThis);

/**
 * Prueba la RUTA REAL del formulario (`POST /api/v1/public/contact`) de punta a
 * punta: servidor HTTP → caso de uso → adaptador de HubSpot → API simulada.
 *
 * Los tests existentes cubren la ruta con un caso de uso falso; este comprueba
 * que el formulario funciona con el CRM real de la migración.
 */
describe('Ruta del formulario web con el CRM HubSpot', () => {
  const servers: Server[] = [];
  const restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores.length = 0;
    for (const server of servers) server.close();
    servers.length = 0;
    vi.restoreAllMocks();
  });

  async function listen(
    processWebsiteContact: { execute: (input: unknown) => Promise<unknown> },
  ): Promise<string> {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };

    const server = startChatboxServer({
      executeConversation: execute,
      processWebsiteContact: processWebsiteContact as never,
      publicApiKey: SITE_KEY,
      memory,
      port: 0,
      corsOrigins: [ORIGIN],
      sessionSecret: 'test-secret',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
      exposeErrorDetails: true,
      model: 'front_agent',
    });
    servers.push(server);
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  function buildCrm(fetchImpl: typeof fetch) {
    const client = new HubspotHttpClient({
      baseUrl: 'https://api.hubapi.com',
      apiVersion: '2026-09',
      accessToken: 'fake-token',
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl,
    });
    return new HubspotCrmAdapter({ client, defaultSource: 'Website', searchCacheTtlMs: 0 });
  }

  function post(base: string, body: unknown, headers: Record<string, string> = {}) {
    // Se usa el fetch original del proceso, no el global (que puede estar
    // sustituido por el simulador de HubSpot).
    return httpFetch(`${base}/api/v1/public/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  }

  it('acepta el envío y crea el contacto en HubSpot con su nota', async () => {
    const hubspot = new FakeHubspotServer();
    restores.push(hubspot.install());

    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg-1' })) };
    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(globalThis.fetch),
      email,
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await post(
      base,
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        topic: 'Integraciones',
        message: 'Necesito conectar mi CRM con el chat.',
        locale: 'es',
      },
      { 'x-api-key': SITE_KEY },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; crmPersisted: boolean; leadId: string };
    expect(payload.ok).toBe(true);
    // El CRM quedó escrito de verdad: no es un éxito inventado.
    expect(payload.crmPersisted).toBe(true);

    // El contacto existe en el CRM con el mensaje en el campo nativo.
    const contacts = hubspot.recordsOfType('contacts');
    expect(contacts).toHaveLength(1);
    expect(contacts[0].properties.email).toBe('ada@example.com');
    expect(contacts[0].properties.company).toBe('Analytical Engines');
    expect(contacts[0].properties.message).toContain('Necesito conectar mi CRM');

    // Y el mensaje íntegro queda como nota asociada.
    const notes = hubspot.recordsOfType('notes');
    expect(notes).toHaveLength(1);
    expect(notes[0].properties.hs_note_body).toContain('ada@example.com');
    expect(notes[0].associations[0].toId).toBe(contacts[0].id);

    // Se enviaron los dos correos: al cliente y la alerta interna.
    expect(email.send).toHaveBeenCalledTimes(2);

    // El acuse al cliente muestra interés, invita a agendar y remite al asistente
    // del sitio. Se comprueba aquí porque es lo que sale por la ruta real.
    const sent = (email.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const ackEmail = sent.find((m: { to: string }) => m.to === 'ada@example.com');
    expect(ackEmail).toBeDefined();
    expect(ackEmail.subject).toMatch(/interesa/i);
    expect(ackEmail.variables.MESSAGE).toMatch(/agendar/i);
    expect(ackEmail.variables.MESSAGE).toContain('synckre.com');
    expect(ackEmail.variables.MESSAGE).toMatch(/asistente/i);
    expect(ackEmail.variables.CTA_LINK).toBe('https://www.synckre.com');
    expect(ackEmail.replyTo).toBe('customer@synckre.com');
  });

  it('rechaza con 403 un origen no permitido (causa típica de que el formulario no funcione)', async () => {
    // El navegador envía el Origin del sitio que publica el formulario. Si ese
    // origen no está en CORS_ORIGIN, la petición se rechaza antes de llegar al
    // caso de uso: es el fallo más habitual en producción.
    const hubspot = new FakeHubspotServer();
    restores.push(hubspot.install());

    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'm' })) };
    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(globalThis.fetch),
      email,
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await httpFetch(`${base}/api/v1/public/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://sitio-no-permitido.example',
        'x-api-key': SITE_KEY,
      },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.com', message: 'Hola' }),
    });

    expect(response.status).toBe(403);
    // Y no debe haber creado nada ni enviado correos.
    expect(hubspot.recordsOfType('contacts')).toHaveLength(0);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('responde al preflight (OPTIONS) del origen permitido', async () => {
    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(globalThis.fetch),
      { send: vi.fn(async () => ({ id: 'm' })) },
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await httpFetch(`${base}/api/v1/public/contact`, {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-api-key',
      },
    });

    // El navegador necesita esto para permitir el POST con x-api-key.
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-headers')).toContain('x-api-key');
  });

  it('exige la API key del sitio', async () => {
    const hubspot = new FakeHubspotServer();
    restores.push(hubspot.install());

    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(globalThis.fetch),
      { send: vi.fn(async () => ({ id: 'm' })) },
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await post(base, { name: 'Ada', email: 'ada@example.com', message: 'Hola' });

    expect(response.status).toBe(401);
    // Sin credencial válida no se escribe nada en el CRM.
    expect(hubspot.recordsOfType('contacts')).toHaveLength(0);
  });

  it('valida la entrada antes de tocar el CRM', async () => {
    const hubspot = new FakeHubspotServer();
    restores.push(hubspot.install());

    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(globalThis.fetch),
      { send: vi.fn(async () => ({ id: 'm' })) },
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await post(
      base,
      { name: 'Ada', email: 'no-es-un-email', message: 'Hola' },
      { 'x-api-key': SITE_KEY },
    );

    expect(response.status).toBe(400);
    expect(hubspot.recordsOfType('contacts')).toHaveLength(0);
  });

  it('devuelve 200 con crmPersisted=false si el CRM falla, y aun así notifica', async () => {
    // HubSpot caído: la ruta no debe devolver un éxito que no lo es, pero
    // tampoco debe perder el contacto sin avisar a nadie.
    const failingFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg-1' })) };
    const useCase = new ProcessWebsiteContactUseCase(
      buildCrm(failingFetch),
      email,
      'ops@synckre.com',
    );
    const base = await listen(useCase);

    const response = await post(
      base,
      { name: 'Ada', email: 'ada@example.com', message: 'Hola' },
      { 'x-api-key': SITE_KEY },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; crmPersisted: boolean };
    expect(payload.crmPersisted).toBe(false);
    expect(email.send).toHaveBeenCalled();
  });

  it('responde 503 si no hay intake de contacto configurado', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const server = startChatboxServer({
      executeConversation: execute,
      publicApiKey: SITE_KEY,
      memory,
      port: 0,
      corsOrigins: [ORIGIN],
      sessionSecret: 'test-secret',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
      exposeErrorDetails: true,
      model: 'front_agent',
    });
    servers.push(server);
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const response = await post(
      base,
      { name: 'Ada', email: 'ada@example.com', message: 'Hola' },
      { 'x-api-key': SITE_KEY },
    );

    expect(response.status).toBe(503);
  });
});
