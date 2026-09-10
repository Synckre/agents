import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresFollowupScheduler } from '@adapters/persistence/postgres-followup-scheduler.adapter';

describe('PostgresFollowupScheduler', () => {
  it('schedule inserta una tarea con status pending y language', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const scheduler = new PostgresFollowupScheduler(poolMock);
    const dueAt = new Date('2026-09-10T15:00:00.000Z');

    const id = await scheduler.schedule({
      leadId: 'LEAD-123',
      conversationId: 'CONV-456',
      dueAt,
      type: 'followup',
      action: 'send_message',
      context: 'Dar seguimiento a la propuesta comercial enviada',
      language: 'es',
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO scheduled_followups'),
      expect.arrayContaining([id, 'LEAD-123', 'CONV-456', dueAt.toISOString(), 'followup', 'send_message', 'Dar seguimiento a la propuesta comercial enviada', null, 'es']),
    );
  });

  it('findDue recupera tanto registros pending como registros en processing cuyo claimed_at esté vencido (Ajuste 1: Stale recovery)', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    const rows = [
      {
        id: 'f-pending',
        lead_id: 'L1',
        conversation_id: 'C1',
        due_at: '2026-09-03T10:00:00.000Z',
        type: 'reminder',
        action: 'send_template_email',
        context: 'Recordatorio',
        template_id: 'tmpl-1',
        language: 'es',
        status: 'pending',
        retry_count: 0,
        claimed_at: null,
        error: null,
        created_at: '2026-09-02T10:00:00.000Z',
        updated_at: '2026-09-02T10:00:00.000Z',
      },
      {
        id: 'f-stale-processing',
        lead_id: 'L2',
        conversation_id: 'C2',
        due_at: '2026-09-03T10:00:00.000Z',
        type: 'followup',
        action: 'send_message',
        context: 'Worker murió previamente',
        template_id: null,
        language: 'en',
        status: 'processing',
        retry_count: 1,
        claimed_at: '2026-09-03T11:00:00.000Z', // 60 min atrás
        error: null,
        created_at: '2026-09-02T10:00:00.000Z',
        updated_at: '2026-09-03T11:00:00.000Z',
      },
    ];

    const queryMock = vi.fn().mockResolvedValue({ rowCount: 2, rows });
    const poolMock = { query: queryMock } as unknown as Pool;

    const scheduler = new PostgresFollowupScheduler(poolMock);
    const results = await scheduler.findDue(now, 50, 15);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('f-pending');
    expect(results[0].status).toBe('pending');
    expect(results[1].id).toBe('f-stale-processing');
    expect(results[1].status).toBe('processing');
    expect(results[1].language).toBe('en');

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'processing' AND claimed_at <="),
      [now.toISOString(), 15, 50],
    );
  });

  it('claimForProcessing implementa bloqueo optimista atómico', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'f-1' }] }) // Primer worker gana
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // Segundo worker pierde

    const poolMock = { query: queryMock } as unknown as Pool;
    const scheduler = new PostgresFollowupScheduler(poolMock);

    const firstClaim = await scheduler.claimForProcessing('f-1', 15);
    const secondClaim = await scheduler.claimForProcessing('f-1', 15);

    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
  });

  it('markAsFailed incrementa retry_count y marca failed al superar maxRetries', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const scheduler = new PostgresFollowupScheduler(poolMock);
    await scheduler.markAsFailed('f-fail', 'Resend error 500', 3);

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("CASE WHEN retry_count + 1 >= $3 THEN 'failed' ELSE 'pending' END"),
      ['f-fail', 'Resend error 500', 3],
    );
  });

  it('cancelByAppointmentId cancela tareas pending y processing vinculadas a la cita', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const poolMock = { query: queryMock } as unknown as Pool;

    const scheduler = new PostgresFollowupScheduler(poolMock);
    await scheduler.cancelByAppointmentId('appt-test-777');

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      ['appt-test-777'],
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE appointment_id = $1 AND status IN ('pending', 'processing')"),
      ['appt-test-777'],
    );
  });
});
