import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresToolSecurityLogger } from '@adapters/persistence/postgres-tool-security-logger.adapter';

describe('PostgresToolSecurityLogger', () => {
  it('inserta un registro en tool_security_logs al auditar una llamada', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const logger = new PostgresToolSecurityLogger(poolMock);
    const date = new Date('2026-09-03T20:00:00.000Z');

    await logger.log({
      toolName: 'send_email',
      conversationId: 'c-100',
      allowed: false,
      reason: 'Rate limit exceeded',
      args: { to: 'test@example.com' },
      timestamp: date,
    });

    // 1er query: ensureSchema
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS tool_security_logs'));

    // 2do query: INSERT
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tool_security_logs'),
      [
        'send_email',
        'c-100',
        false,
        'Rate limit exceeded',
        JSON.stringify({ to: 'test@example.com' }),
        date,
      ],
    );
  });

  it('permite valores nulos para reason y args cuando no están definidos', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const logger = new PostgresToolSecurityLogger(poolMock);
    const date = new Date('2026-09-03T20:00:00.000Z');

    await logger.log({
      toolName: 'search_knowledge_base',
      conversationId: 'c-200',
      allowed: true,
      timestamp: date,
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tool_security_logs'),
      [
        'search_knowledge_base',
        'c-200',
        true,
        null,
        null,
        date,
      ],
    );
  });

  it('maneja de forma segura argumentos con referencias circulares', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const logger = new PostgresToolSecurityLogger(poolMock);

    const circularObj: Record<string, unknown> = { key: 'value' };
    circularObj.self = circularObj;

    await expect(
      logger.log({
        toolName: 'save_lead',
        conversationId: 'c-300',
        allowed: true,
        args: circularObj,
      }),
    ).resolves.not.toThrow();

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tool_security_logs'),
      expect.arrayContaining(['save_lead', 'c-300', true, null, JSON.stringify({ error: 'Unserializable payload' })]),
    );
  });
});
