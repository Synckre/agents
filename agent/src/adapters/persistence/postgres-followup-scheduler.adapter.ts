import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  FollowupAction,
  FollowupLanguage,
  FollowupStatus,
  FollowupType,
  ScheduledFollowup,
} from '@core/domain/scheduled-followup.entity';
import {
  IFollowupScheduler,
  ScheduleFollowupInput,
} from '@core/ports/followup-scheduler.port';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema';

interface FollowupRow {
  id: string;
  lead_id: string;
  conversation_id: string;
  appointment_id: string | null;
  due_at: Date;
  type: string;
  action: string;
  context: string;
  template_id: string | null;
  language: string;
  status: string;
  retry_count: number;
  claimed_at: Date | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: FollowupRow): ScheduledFollowup {
  return {
    id: row.id,
    leadId: row.lead_id,
    conversationId: row.conversation_id,
    appointmentId: row.appointment_id ?? undefined,
    dueAt: new Date(row.due_at),
    type: row.type as FollowupType,
    action: row.action as FollowupAction,
    context: row.context,
    templateId: row.template_id ?? undefined,
    language: (row.language as FollowupLanguage) || 'es',
    status: row.status as FollowupStatus,
    retryCount: Number(row.retry_count ?? 0),
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Adaptador de persistencia PostgreSQL para IFollowupScheduler.
 * Implementa bloqueo optimista (processing) y recuperación de tareas atascadas (stale).
 */
export class PostgresFollowupScheduler implements IFollowupScheduler {
  private ready?: Promise<void>;

  constructor(private readonly pool: Pool) {}

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = this.pool.query(POSTGRES_SCHEMA_SQL).then(() => undefined);
    }
    await this.ready;
  }

  async schedule(input: ScheduleFollowupInput): Promise<string> {
    await this.ensureSchema();
    const id = randomUUID();
    const language = input.language ?? 'es';

    await this.pool.query(
      `INSERT INTO scheduled_followups (
        id, lead_id, conversation_id, due_at, type, action, context, template_id, language, status, retry_count, appointment_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 0, $10)`,
      [
        id,
        input.leadId,
        input.conversationId,
        input.dueAt.toISOString(),
        input.type,
        input.action,
        input.context,
        input.templateId ?? null,
        language,
        input.appointmentId ?? null,
      ],
    );

    return id;
  }

  async findDue(now: Date, limit: number, staleMinutes: number): Promise<ScheduledFollowup[]> {
    await this.ensureSchema();
    const res = await this.pool.query<FollowupRow>(
      `SELECT * FROM scheduled_followups
       WHERE (status = 'pending' AND due_at <= $1)
          OR (status = 'processing' AND claimed_at <= ($1::timestamptz - ($2 || ' minutes')::interval))
       ORDER BY due_at ASC
       LIMIT $3`,
      [now.toISOString(), staleMinutes, limit],
    );

    return res.rows.map(mapRow);
  }

  async claimForProcessing(id: string, staleMinutes: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE scheduled_followups
       SET status = 'processing', claimed_at = now(), updated_at = now()
       WHERE id = $1 AND (
         status = 'pending' OR
         (status = 'processing' AND claimed_at <= (now() - ($2 || ' minutes')::interval))
       )
       RETURNING id`,
      [id, staleMinutes],
    );

    return (res.rowCount ?? 0) > 0;
  }

  async markAsSent(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_followups
       SET status = 'sent', updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async markAsFailed(id: string, reason: string, maxRetries: number): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_followups
       SET retry_count = retry_count + 1,
           error = $2,
           status = CASE WHEN retry_count + 1 >= $3 THEN 'failed' ELSE 'pending' END,
           updated_at = now()
       WHERE id = $1`,
      [id, reason, maxRetries],
    );
  }

  async cancel(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_followups
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status IN ('pending', 'processing')`,
      [id],
    );
  }

  async cancelByAppointmentId(appointmentId: string): Promise<void> {
    await this.pool.query(
      `UPDATE scheduled_followups
       SET status = 'cancelled', updated_at = now()
       WHERE appointment_id = $1 AND status IN ('pending', 'processing')`,
      [appointmentId],
    );
  }
}
