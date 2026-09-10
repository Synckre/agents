import { describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { CancelAppointmentTool } from '@adapters/tools/cancel-appointment.tool';
import { RequestHumanTool } from '@adapters/tools/request-human.tool';
import { RescheduleAppointmentTool } from '@adapters/tools/reschedule-appointment.tool';
import { SaveLeadTool } from '@adapters/tools/save-lead.tool';
import { ScheduleAppointmentTool } from '@adapters/tools/schedule-appointment.tool';
import { SearchKnowledgeBaseTool } from '@adapters/tools/search-knowledge-base.tool';
import { SearchLeadTool } from '@adapters/tools/search-lead.tool';
import { SendEmailTool } from '@adapters/tools/send-email.tool';
import { IToolContext } from '@adapters/tools/tool-context';
import { CONVERSATION_META } from '@core/domain/conversation.entity';
import { ICalendar } from '@core/ports/calendar.port';
import { ICrm, ILead } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IKnowledgeBase } from '@core/ports/knowledge-base.port';

function context(memory: InMemoryStore, conversationId = 'c1'): IToolContext {
  return {
    conversationId,
    maxAppointments: 2,
    memory,
    getState: () => ({
      id: conversationId,
      messages: [{ role: 'user', content: 'hola' }],
    }),
  };
}

function fakeCrm(overrides: Partial<ICrm> = {}): ICrm {
  return {
    findLead: vi.fn(async () => null),
    getLeadById: vi.fn(async () => null),
    createLead: vi.fn(async (draft) => ({ id: 'LEAD-1', ...draft })),
    updateLead: vi.fn(async (id, draft) => ({ id, ...draft })),
    ...overrides,
  };
}

describe('front_agent tools — autonomía', () => {
  it('search_lead ignora un leadId arbitrario y enlaza el resultado de email/teléfono', async () => {
    const memory = new InMemoryStore();
    await memory.save({ id: 'c1', messages: [] });
    const found: ILead = { id: 'LEAD-REAL', email: 'user@example.com', name: 'Ana' };
    const crm = fakeCrm({
      findLead: vi.fn(async () => found),
      getLeadById: vi.fn(async () => found),
    });

    const tool = new SearchLeadTool(crm, context(memory));
    const result = await tool.execute({
      email: 'user@example.com',
      leadId: 'LEAD-OTHER',
    } as never);

    expect(result).toMatchObject({ ok: true, lead: found });
    expect(crm.getLeadById).not.toHaveBeenCalledWith('LEAD-OTHER');
    const stored = await memory.getById('c1');
    expect(stored?.metadata?.[CONVERSATION_META.leadId]).toBe('LEAD-REAL');
  });

  it('save_lead actualiza solo el lead ya asociado a la conversación', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [],
      metadata: { [CONVERSATION_META.leadId]: 'LEAD-BOUND' },
    });
    const crm = fakeCrm();
    const tool = new SaveLeadTool(crm, context(memory));

    const result = await tool.execute({
      name: 'Ana',
      email: 'ana@example.com',
      leadId: 'LEAD-OTHER',
    } as never);

    expect(result).toMatchObject({ ok: true, action: 'updated' });
    expect(crm.updateLead).toHaveBeenCalledWith('LEAD-BOUND', expect.anything());
    expect(crm.createLead).not.toHaveBeenCalled();
  });

  it('save_lead recupera el teléfono y nombre literal del usuario ante distorsiones del LLM', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'Mi nombre es Ebrahim Buceta y mi teléfono es +34 612 34 56 78' }],
    });
    const crm = fakeCrm();
    const tool = new SaveLeadTool(crm, {
      conversationId: 'c1',
      maxAppointments: 2,
      memory,
      getState: () => ({
        id: 'c1',
        messages: [{ role: 'user', content: 'Mi nombre es Ebrahim Buceta y mi teléfono es +34 612 34 56 78' }],
      }),
    });

    // El LLM pasa el nombre con errata y el teléfono sin código de país
    await tool.execute({
      name: 'Ebrahim Bucetta',
      phone: '612345678',
    });

    expect(crm.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ebrahim Buceta',
        phone: '+34 612 34 56 78',
      }),
    );
  });

  it('send_email rechaza destinatarios que no se dieron en la conversación', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [],
      metadata: { [CONVERSATION_META.allowedEmails]: ['user@example.com'] },
    });
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg-1' })) };
    const tool = new SendEmailTool(email, context(memory));

    const denied = await tool.execute({
      to: 'other@example.com',
      subject: 'Hola',
      body: 'cuerpo',
    });
    expect(denied).toMatchObject({ ok: false });
    expect(email.send).not.toHaveBeenCalled();

    const allowed = await tool.execute({
      to: 'user@example.com',
      subject: 'Hola',
      body: 'cuerpo',
    });
    expect(allowed).toMatchObject({ ok: true });
    expect(email.send).toHaveBeenCalledOnce();
  });

  it('schedule_appointment respeta el máximo de citas por conversación', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [],
      metadata: { [CONVERSATION_META.appointmentCount]: 2 },
    });
    const calendar: ICalendar = {
      findAvailability: vi.fn(async () => []),
      createAppointment: vi.fn(async (input) => ({ id: 'evt', ...input })),
      rescheduleAppointment: vi.fn(async (id, range) => ({ id, ...range, attendeeName: 'Ana' })),
      cancelAppointment: vi.fn(async () => {}),
    };
    const tool = new ScheduleAppointmentTool(calendar, context(memory));

    const result = await tool.execute({
      start: '2026-09-02T10:00:00.000Z',
      end: '2026-09-02T10:30:00.000Z',
      attendeeName: 'Ana',
    });

    expect(result).toMatchObject({ ok: false });
    expect(String((result as { error: string }).error)).toMatch(/limit/i);
    expect(calendar.createAppointment).not.toHaveBeenCalled();
  });

  it('save_lead extrae el email literal exacto del usuario si el LLM trunca letras', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'Mi correo es ebrahimbuceta@gmail.com y me llamo Ebrahim' }],
    });
    const crm = fakeCrm();
    const tool = new SaveLeadTool(crm, context(memory));

    // El LLM equivocadamente envía una versión truncada
    const result = await tool.execute({
      name: 'Ebrahim',
      email: 'ebrahimbuce@gmail.com',
    });

    expect(result).toMatchObject({ ok: true, action: 'created' });
    expect(crm.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ebrahimbuceta@gmail.com' }),
    );
  });

  it('reschedule_appointment reprograma la cita de la sesión y bloquea IDs externos por seguridad', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'agendar cita' }],
    });

    const calendar: ICalendar = {
      findAvailability: vi.fn(async () => []),
      createAppointment: vi.fn(async (input) => ({ id: 'EVT-SESSION-1', ...input })),
      rescheduleAppointment: vi.fn(async (id, range) => ({
        id,
        ...range,
        attendeeName: 'Carlos',
      })),
      cancelAppointment: vi.fn(async () => {}),
    };

    // 1. Agendamos una cita en esta sesión
    const scheduleTool = new ScheduleAppointmentTool(calendar, context(memory));
    await scheduleTool.execute({
      start: '2026-09-02T10:00:00.000Z',
      end: '2026-09-02T10:30:00.000Z',
      attendeeName: 'Carlos',
    });

    const rescheduleTool = new RescheduleAppointmentTool(calendar, context(memory));

    // 2. Intento de ataque: reprogramar una cita con un ID que NO pertenece a esta sesión
    const attackResult = await rescheduleTool.execute({
      appointmentId: 'EVT-VICTIM-999',
      start: '2026-09-03T11:00:00.000Z',
      end: '2026-09-03T11:30:00.000Z',
    });
    expect(attackResult).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Security violation/i),
    });
    expect(calendar.rescheduleAppointment).not.toHaveBeenCalled();

    // 3. Reprogramación legítima de la cita de la sesión
    const legitimateResult = await rescheduleTool.execute({
      appointmentId: 'EVT-SESSION-1',
      start: '2026-09-03T11:00:00.000Z',
      end: '2026-09-03T11:30:00.000Z',
    });
    expect(legitimateResult).toMatchObject({ ok: true });
    expect(calendar.rescheduleAppointment).toHaveBeenCalledWith('EVT-SESSION-1', {
      start: '2026-09-03T11:00:00-04:00',
      end: '2026-09-03T11:30:00-04:00',
    });
  });

  it('cancel_appointment cancela la cita de la sesión y bloquea IDs externos por seguridad', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'agendar cita' }],
    });

    const calendar: ICalendar = {
      findAvailability: vi.fn(async () => []),
      createAppointment: vi.fn(async (input) => ({ id: 'EVT-SESSION-2', ...input })),
      rescheduleAppointment: vi.fn(async (id, range) => ({ id, ...range, attendeeName: 'Laura' })),
      cancelAppointment: vi.fn(async () => {}),
    };

    const scheduleTool = new ScheduleAppointmentTool(calendar, context(memory));
    await scheduleTool.execute({
      start: '2026-09-02T12:00:00.000Z',
      end: '2026-09-02T12:30:00.000Z',
      attendeeName: 'Laura',
    });

    const cancelTool = new CancelAppointmentTool(calendar, context(memory));

    // 1. Intento de cancelar una cita externa
    const attackResult = await cancelTool.execute({
      appointmentId: 'EVT-OTHER-USER',
    });
    expect(attackResult).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Security violation/i),
    });
    expect(calendar.cancelAppointment).not.toHaveBeenCalled();

    // 2. Cancelación legítima de la cita de la propia sesión
    const legitimateResult = await cancelTool.execute({});
    expect(legitimateResult).toMatchObject({
      ok: true,
      cancelledAppointmentId: 'EVT-SESSION-2',
    });
    expect(calendar.cancelAppointment).toHaveBeenCalledWith('EVT-SESSION-2');
  });

  it('search_knowledge_base solo consulta documentos public', async () => {
    const knowledge: IKnowledgeBase = {
      search: vi.fn(async () => [{ id: '1', content: 'faq', tags: ['public'] }]),
    };
    const tool = new SearchKnowledgeBaseTool(knowledge);
    await tool.execute({ query: 'servicios' });
    expect(knowledge.search).toHaveBeenCalledWith('servicios', ['public']);
  });

  it('request_human pausa, persiste y envía alerta interna', async () => {
    const memory = new InMemoryStore();
    await memory.save({ id: 'c1', messages: [{ role: 'user', content: 'quiero un humano' }] });
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'alert-1' })) };
    const tool = new RequestHumanTool(email, context(memory), 'ops@example.com');

    const result = await tool.execute({ reason: 'el usuario lo pidió' });
    expect(result).toMatchObject({ ok: true, status: 'paused_for_human' });
    expect(email.send).toHaveBeenCalledOnce();
    const stored = await memory.getById('c1');
    expect(stored?.status).toBe('paused_for_human');
  });
});
