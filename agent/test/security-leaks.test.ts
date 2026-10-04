import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inferTag } from '../src/scripts/ingest-knowledge';
import { safeToolError } from '../src/adapters/tools/tool-error';
import { UserFacingError } from '../src/core/domain/user-facing-error';
import { CrmError } from '../src/core/ports/crm.port';
import { PgVectorKnowledgeBase } from '../src/adapters/knowledge/pgvector-knowledge-base.adapter';
import type { Pool } from 'pg';
import type { IEmbeddingProvider } from '../src/core/ports/embedding-provider.port';

/**
 * Regresiones de fuga de seguridad detectadas en la auditoría. Cada prueba
 * corresponde a un hallazgo concreto: si alguien revierte el arreglo, falla.
 */

describe('SEGURIDAD — la ingesta no puede publicar documentos internos', () => {
  it('un fichero bajo internal/ es siempre interno', () => {
    expect(inferTag('knowledge/internal/README.md')).toBe('internal');
    expect(inferTag('knowledge/internal/secretos/plan.md')).toBe('internal');
  });

  it('--tag public NO puede reclasificar un documento interno', () => {
    // Este era el fallo: `npm run ingest -- --tag public` etiquetaba los
    // documentos internos como públicos y los exponía en el chat del sitio.
    expect(inferTag('knowledge/internal/README.md', 'public')).toBe('internal');
    expect(inferTag('/abs/knowledge/internal/x.md', 'public')).toBe('internal');
  });

  it('--tag sigue funcionando para documentos públicos', () => {
    expect(inferTag('knowledge/public/faq.md', 'internal')).toBe('internal');
    expect(inferTag('knowledge/public/faq.md')).toBe('public');
  });

  it('no confunde una carpeta que sólo contiene la palabra internal', () => {
    expect(inferTag('knowledge/public/international-pricing.md')).toBe('public');
  });
});

describe('SEGURIDAD — la búsqueda pública excluye material interno', () => {
  let captured: { sql: string; params: unknown[] } | null = null;

  function buildKb(): PgVectorKnowledgeBase {
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        if (/knowledge_chunks/.test(sql) && /embedding <=>/.test(sql)) {
          captured = { sql, params };
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;
    const embeddings = {
      dimensions: () => 768,
      embed: vi.fn(async () => new Array(768).fill(0.1)),
    } as unknown as IEmbeddingProvider;
    return new PgVectorKnowledgeBase(pool, embeddings);
  }

  afterEach(() => {
    captured = null;
  });

  it('al pedir sólo "public" excluye los fragmentos internos', async () => {
    await buildKb().search('horario', ['public']);

    expect(captured).not.toBeNull();
    expect(captured!.sql).toMatch(/NOT \(tags @> ARRAY\['internal'\]/);
    // El parámetro que activa la exclusión debe ser true.
    expect(captured!.params[3]).toBe(true);
  });

  it('si se piden internos expresamente, no se excluyen', async () => {
    await buildKb().search('procedimiento', ['internal']);

    expect(captured!.params[3]).toBe(false);
  });
});

describe('SEGURIDAD — los errores internos no llegan al usuario', () => {
  it('un error de CRM se sustituye por un mensaje neutro', () => {
    const error = new CrmError({
      code: 'CRM_UNAUTHORIZED',
      message:
        'CRM authentication failed (401). Verify the HubSpot Private App token and that it was not revoked.',
      status: 401,
      correlationId: 'abc-123',
      retryable: false,
    });

    const message = safeToolError(error, 'CRM save failed');

    // Nada de detalles de implementación.
    expect(message).not.toMatch(/401|token|HubSpot|correlation|Private App/i);
    expect(message).toBeTruthy();
    expect(message).toMatch(/CRM/i);
  });

  it('no filtra los scopes que faltan ni el correlationId', () => {
    const error = new CrmError({
      code: 'CRM_FORBIDDEN',
      message:
        'CRM access forbidden (403) on updateContact. The Private App is missing required scopes: crm.objects.contacts.write.',
      status: 403,
      correlationId: '01a107df-c6d3',
      retryable: false,
    });

    const message = safeToolError(error, 'fallback');

    expect(message).not.toMatch(/crm\.objects|scope|403|01a107df/i);
  });

  it('el rate limit se explica sin detalles internos', () => {
    const error = new CrmError({
      code: 'CRM_RATE_LIMITED',
      message: 'CRM rate limit exceeded (429, policy DAILY) on createContact',
      status: 429,
      retryable: true,
    });

    const message = safeToolError(error, 'fallback');

    expect(message).not.toMatch(/429|DAILY|policy/i);
    expect(message).toMatch(/try again/i);
  });

  it('los errores pensados para el usuario SÍ se propagan', () => {
    // "No se puede reservar en el pasado" es información útil, no una fuga.
    const error = new UserFacingError('Cannot book appointments in the past. Please choose an upcoming date and time.');
    expect(safeToolError(error, 'Scheduling failed')).toBe(error.message);
  });

  it('un error desconocido usa el mensaje de respaldo', () => {
    expect(safeToolError(new Error('ECONNREFUSED 10.0.0.5:5432'), 'CRM save failed')).toBe(
      'CRM save failed',
    );
  });
});

describe('SEGURIDAD — el contexto de build de Docker no incluye secretos', () => {
  it('.dockerignore excluye .env a cualquier profundidad', () => {
    const content = readFileSync(path.resolve('.dockerignore'), 'utf-8');
    const patterns = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    // Los patrones sin comodín sólo casan en la raíz: `chainlit/.env` se colaba.
    expect(patterns).toContain('**/.env');
    expect(patterns).toContain('**/.env.*');
    expect(patterns).toContain('**/node_modules');
    expect(patterns).toContain('**/.venv');
  });
});

describe('SEGURIDAD — no se registran fragmentos de credenciales', () => {
  it('el adaptador legacy no escribe parte de la API key', async () => {
    const { ErpNextAdapter } = await import('../src/adapters/crm/erpnext.adapter');
    const adapter = new ErpNextAdapter({
      baseUrl: 'https://erp.example.com',
      apiKey: 'CLAVE_SECRETA_DE_ERPNEXT_123',
      apiSecret: 'secreto',
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await adapter.findLead({ email: 'a@b.com' }).catch(() => undefined);
      const logged = errorSpy.mock.calls.flat().join(' ');
      // La clave no debe aparecer, ni siquiera en parte.
      expect(logged).not.toContain('CLAVE');
      expect(logged).not.toContain('CLAV');
      // Pero sí conviene saber cuánto mide para detectar valores truncados.
      expect(logged).toMatch(/len=28/);
    } finally {
      globalThis.fetch = originalFetch;
      errorSpy.mockRestore();
    }
  });
});
