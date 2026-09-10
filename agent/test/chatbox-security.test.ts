import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startChatboxServer } from '@adapters/http/chatbox-server';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { createRateLimiter, hashSessionToken } from '@adapters/http/security';
import { IConversation } from '@core/domain/conversation.entity';
import { IExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';
import type { Server } from 'node:http';

const SITE_API_KEY = 'test-public-key';

async function listen(
  memory: InMemoryStore,
  execute: IExecuteConversationUseCase,
): Promise<{ server: Server; base: string }> {
  const server = startChatboxServer({
    executeConversation: execute,
    memory,
    publicApiKey: SITE_API_KEY,
    port: 0,
    corsOrigins: ['https://www.synckre.example'],
    sessionSecret: 'test-secret',
    rateLimitWindowMs: 60_000,
    rateLimitMax: 20,
    exposeErrorDetails: true,
    model: 'front_agent',
  });
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe('OpenAI-compatible chatbox API', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it('lista el modelo en /v1/models', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    const response = await fetch(`${base}/v1/models`, {
      headers: { Origin: 'https://www.synckre.example' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { object: string; data: Array<{ id: string }> };
    expect(body.object).toBe('list');
    expect(body.data[0]?.id).toBe('front_agent');
  });

  it('rechaza completions con un Bearer inválido', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = {
      execute: async () => {
        throw new Error('must not run');
      },
    };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    const session = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { 'x-api-key': SITE_API_KEY },
    });
    const created = (await session.json()) as { id: string; api_key: string };

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer totally-invalid-token',
        Origin: 'https://www.synckre.example',
      },
      body: JSON.stringify({
        model: 'front_agent',
        messages: [{ role: 'user', content: 'hola' }],
      }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_api_key');
    expect(created.id).toBeTruthy();
  });

  it('acepta el api_key de sesión en Authorization Bearer', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = {
      async execute(conversationId, message): Promise<IConversation> {
        const existing = await memory.getById(conversationId);
        const updated: IConversation = {
          id: conversationId,
          messages: [
            ...(existing?.messages ?? []),
            message,
            { role: 'assistant', content: 'Hola', name: 'front_agent' },
          ],
          status: 'active',
          metadata: existing?.metadata,
        };
        await memory.save(updated);
        return updated;
      },
    };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    const session = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { 'x-api-key': SITE_API_KEY },
    });
    const created = (await session.json()) as { id: string; api_key: string };

    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${created.api_key}`,
        Origin: 'https://www.synckre.example',
      },
      body: JSON.stringify({
        model: 'front_agent',
        messages: [{ role: 'user', content: 'hola' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      object: string;
      model: string;
      choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
    };
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('front_agent');
    expect(body.choices[0]?.message).toEqual({ role: 'assistant', content: 'Hola' });
    expect(body.choices[0]?.finish_reason).toBe('stop');
  });

  it('bloquea orígenes fuera de CORS_ORIGIN', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    const response = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
  });

  it('rate limiter corta tras superar el máximo', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(false);
  });

  it('soporta sesión y autenticación en /api/copilotkit en el servidor unificado', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = {
      async execute(conversationId, message): Promise<IConversation> {
        return {
          id: conversationId,
          messages: [message, { role: 'assistant', content: 'OK Copilot', name: 'front_agent' }],
          status: 'active',
        };
      },
    };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    // 1. Crear sesión vía /api/copilotkit/session
    const sessionRes = await fetch(`${base}/api/copilotkit/session`, {
      method: 'POST',
      headers: {
        Origin: 'https://www.synckre.example',
        'x-api-key': SITE_API_KEY,
      },
    });
    expect(sessionRes.status).toBe(201);
    const session = (await sessionRes.json()) as { id: string; api_key: string };
    expect(session.api_key).toBeTruthy();

    // 2. Comprobar rechazo sin token
    const unauthRes = await fetch(`${base}/api/copilotkit`, {
      method: 'POST',
      headers: { Origin: 'https://www.synckre.example' },
    });
    expect(unauthRes.status).toBe(401);

    // 3. Comprobar rechazo con token inválido
    const badTokenRes = await fetch(`${base}/api/copilotkit`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid.token',
        Origin: 'https://www.synckre.example',
      },
    });
    expect(badTokenRes.status).toBe(401);
  });

  it('el hash del token es determinista para el mismo secreto', () => {
    expect(hashSessionToken('s', 'tok')).toBe(hashSessionToken('s', 'tok'));
    expect(hashSessionToken('s', 'tok')).not.toBe(hashSessionToken('s', 'other'));
  });

  it('no filtra errores de Postgres y marca /health como caído', async () => {
    const memory = {
      save: async () => {
        const error = new Error('password authentication failed for user \'neondb_owner\'');
        (error as Error & { code: string }).code = '28P01';
        throw error;
      },
      getById: async () => null,
      delete: async () => undefined,
    };
    const execute: IExecuteConversationUseCase = {
      execute: async () => {
        throw new Error('must not run');
      },
    };
    const server = startChatboxServer({
      executeConversation: execute,
      memory,
      port: 0,
      corsOrigins: ['https://www.synckre.example'],
      sessionSecret: 'test-secret',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
      exposeErrorDetails: true,
      model: 'front_agent',
      publicApiKey: SITE_API_KEY,
      checkReady: async () => {
        throw new Error('password authentication failed for user \'neondb_owner\'');
      },
    });
    await once(server, 'listening');
    servers.push(server);
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toMatchObject({ ok: false });

    const session = await fetch(`${base}/api/copilotkit/session`, {
      method: 'POST',
      headers: {
        Origin: 'https://www.synckre.example',
        'x-api-key': SITE_API_KEY,
      },
    });
    expect(session.status).toBe(503);
    const body = (await session.json()) as { error: { message: string; code: string } };
    expect(body.error.code).toBe('storage_unavailable');
    expect(body.error.message).not.toMatch(/password/i);
  });

  it('guarda el formulario público y exige x-api-key', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const processWebsiteContact = {
      execute: async () => ({
        ok: true as const,
        leadId: 'LEAD-9',
        action: 'created' as const,
        emails: { client: true, internal: true },
      }),
    };
    const server = startChatboxServer({
      executeConversation: execute,
      processWebsiteContact,
      publicApiKey: 'test-public-key',
      memory,
      port: 0,
      corsOrigins: ['https://www.synckre.example'],
      sessionSecret: 'test-secret',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
      exposeErrorDetails: true,
      model: 'front_agent',
    });
    await once(server, 'listening');
    servers.push(server);
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const unauthorized = await fetch(`${base}/api/v1/public/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.synckre.example',
      },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@company.com',
        message: 'Hello',
      }),
    });
    expect(unauthorized.status).toBe(401);

    const ok = await fetch(`${base}/api/v1/public/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.synckre.example',
        'x-api-key': 'test-public-key',
      },
      body: JSON.stringify({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@company.com',
        message: 'Need a system.',
        locale: 'en',
      }),
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ ok: true, leadId: 'LEAD-9' });
  });

  it('exige x-api-key para crear sesión de chat', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const { server, base } = await listen(memory, execute);
    servers.push(server);

    const unauthorized = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { Origin: 'https://www.synckre.example' },
    });
    expect(unauthorized.status).toBe(401);

    const ok = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: {
        Origin: 'https://www.synckre.example',
        'x-api-key': SITE_API_KEY,
      },
    });
    expect(ok.status).toBe(201);
  });

  it('no abre contacto ni sesión si falta publicApiKey', async () => {
    const memory = new InMemoryStore();
    const execute: IExecuteConversationUseCase = { execute: async () => ({ id: 'x', messages: [] }) };
    const server = startChatboxServer({
      executeConversation: execute,
      processWebsiteContact: {
        execute: async () => ({
          ok: true as const,
          leadId: 'LEAD-1',
          action: 'created' as const,
          emails: { client: false, internal: false },
        }),
      },
      memory,
      port: 0,
      corsOrigins: ['https://www.synckre.example'],
      sessionSecret: 'test-secret',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20,
      exposeErrorDetails: true,
      model: 'front_agent',
    });
    await once(server, 'listening');
    servers.push(server);
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const session = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: {
        Origin: 'https://www.synckre.example',
        'x-api-key': SITE_API_KEY,
      },
    });
    expect(session.status).toBe(503);

    const contact = await fetch(`${base}/api/v1/public/contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.synckre.example',
        'x-api-key': SITE_API_KEY,
      },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@company.com',
        message: 'Hello',
      }),
    });
    expect(contact.status).toBe(503);
  });
});
