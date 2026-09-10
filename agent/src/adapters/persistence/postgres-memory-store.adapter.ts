import type { Pool } from 'pg';
import {
  ConversationStatus,
  IConversation,
} from '@core/domain/conversation.entity';
import { IMessage } from '@core/domain/message.value-object';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema';

interface ConversationRow {
  id: string;
  messages: unknown;
  current_agent: string | null;
  metadata: unknown;
  status: string;
}

function reviveMessage(raw: unknown): IMessage {
  const message = raw as IMessage;
  return {
    ...message,
    timestamp: message.timestamp ? new Date(message.timestamp) : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asStatus(value: string | null | undefined): ConversationStatus {
  return value === 'paused_for_human' ? 'paused_for_human' : 'active';
}

/**
 * Persistencia de conversaciones en Postgres (IMemoryStore).
 */
export class PostgresMemoryStore implements IMemoryStore {
  private ready: Promise<void> | null = null;

  constructor(private readonly pool: Pool) {}

  async save(conversation: IConversation): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO conversations (id, messages, current_agent, metadata, status, updated_at)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, now())
       ON CONFLICT (id) DO UPDATE SET
         messages = EXCLUDED.messages,
         current_agent = EXCLUDED.current_agent,
         metadata = EXCLUDED.metadata,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        conversation.id,
        JSON.stringify(conversation.messages),
        conversation.currentAgent ?? null,
        JSON.stringify(conversation.metadata ?? {}),
        conversation.status ?? 'active',
      ],
    );
  }

  async getById(id: string): Promise<IConversation | null> {
    await this.ensureSchema();
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, messages, current_agent, metadata, status FROM conversations WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const messages = Array.isArray(row.messages) ? row.messages.map(reviveMessage) : [];

    return {
      id: row.id,
      messages,
      currentAgent: row.current_agent ?? undefined,
      metadata: asRecord(row.metadata),
      status: asStatus(row.status),
    };
  }

  async delete(id: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(`DELETE FROM conversations WHERE id = $1`, [id]);
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool.query(POSTGRES_SCHEMA_SQL).then(() => undefined);
    }
    await this.ready;
  }
}
