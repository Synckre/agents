import type { Pool } from 'pg';
import { IToolSecurityLogger, ToolSecurityLogEntry } from '@core/ports/tool-security-logger.port';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema';

/**
 * Adaptador de persistencia en PostgreSQL para la auditoría de seguridad de herramientas (ToolGuard).
 */
export class PostgresToolSecurityLogger implements IToolSecurityLogger {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  async log(entry: ToolSecurityLogEntry): Promise<void> {
    await this.ensureSchema();

    let serializedArgs: string | null = null;
    if (entry.args !== undefined) {
      try {
        serializedArgs = JSON.stringify(entry.args);
      } catch {
        serializedArgs = JSON.stringify({ error: 'Unserializable payload' });
      }
    }

    await this.pool.query(
      `INSERT INTO tool_security_logs (tool_name, conversation_id, allowed, reason, args, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        entry.toolName,
        entry.conversationId,
        entry.allowed,
        entry.reason ?? null,
        serializedArgs,
        entry.timestamp ?? new Date(),
      ],
    );
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool.query(POSTGRES_SCHEMA_SQL).then(() => undefined);
    }
    await this.ready;
  }
}
