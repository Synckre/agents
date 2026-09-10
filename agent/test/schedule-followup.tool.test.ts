import { describe, expect, it, vi } from 'vitest';
import { ScheduleFollowupTool } from '@adapters/tools/schedule-followup.tool';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IToolContext } from '@adapters/tools/tool-context';
import { Conversation } from '@core/domain/conversation.entity';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';

describe('ScheduleFollowupTool', () => {
  it('Ajuste 4: Rechaza estrictamente action send_template_email si falta templateId', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({ id: 'c1', messages: [] }).bindLead('LEAD-100');
    await memory.save(conv);

    const schedulerMock: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const ctx: IToolContext = {
      conversationId: 'c1',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'c1', messages: [] }),
    };

    const tool = new ScheduleFollowupTool(schedulerMock, ctx);

    // Sin templateId
    const res = await tool.execute({
      dueAt: '2026-09-10T15:00:00.000Z',
      type: 'reminder',
      action: 'send_template_email',
      context: 'Recordatorio de demostración',
    });

    expect(res).toMatchObject({
      ok: false,
      error: "templateId is required when action is 'send_template_email'",
    });
    expect(schedulerMock.schedule).not.toHaveBeenCalled();
  });

  it('Rechaza agendar seguimiento si no hay un lead vinculado a la conversación', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({ id: 'c1', messages: [] });
    await memory.save(conv);

    const schedulerMock: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const ctx: IToolContext = {
      conversationId: 'c1',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'c1', messages: [] }),
    };

    const tool = new ScheduleFollowupTool(schedulerMock, ctx);
    const res = await tool.execute({
      dueAt: '2026-09-10T15:00:00.000Z',
      type: 'followup',
      action: 'send_message',
      context: 'Contactar la próxima semana para revisar propuesta',
    });

    expect(res).toMatchObject({
      ok: false,
      error: expect.stringContaining('No lead is bound to this conversation yet'),
    });
  });

  it('Registra la intención exitosamente con lead vinculado y parámetros válidos', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({ id: 'c1', messages: [] }).bindLead('LEAD-200');
    await memory.save(conv);

    const schedulerMock: IFollowupScheduler = {
      schedule: vi.fn().mockResolvedValue('followup-uuid-1'),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const ctx: IToolContext = {
      conversationId: 'c1',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'c1', messages: [] }),
    };

    const tool = new ScheduleFollowupTool(schedulerMock, ctx);
    const res = await tool.execute({
      dueAt: '2026-09-10T15:00:00.000Z',
      type: 'followup',
      action: 'notify_human',
      context: 'Cliente solicitó llamada del director comercial',
      language: 'es',
    });

    expect(res).toMatchObject({
      ok: true,
      followupId: 'followup-uuid-1',
      action: 'notify_human',
      type: 'followup',
      language: 'es',
    });
    expect(schedulerMock.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'LEAD-200',
        conversationId: 'c1',
        action: 'notify_human',
        context: 'Cliente solicitó llamada del director comercial',
      }),
    );
  });
});
