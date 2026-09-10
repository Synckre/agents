import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '@core/domain/conversation.entity';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { ScheduleAppointmentTool } from '@adapters/tools/schedule-appointment.tool';
import { RescheduleAppointmentTool } from '@adapters/tools/reschedule-appointment.tool';
import { CancelAppointmentTool } from '@adapters/tools/cancel-appointment.tool';
import { SendEmailTool } from '@adapters/tools/send-email.tool';
import { RequestHumanTool } from '@adapters/tools/request-human.tool';
import { SendInternalAlertTool } from '@adapters/tools/send-internal-alert.tool';
import { IToolContext } from '@adapters/tools/tool-context';
import { RESEND_TEMPLATES } from '@adapters/email/resend-templates.config';

describe('Internal Alert Email Notifications', () => {
  const internalAlertEmail = 'account@synckre.com';

  it('schedule_appointment envía notificación interna usando plantilla interna dedicada (256c273c-1059-41d4-894e-3b3aaa8aca4a)', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-sched',
      messages: [{ role: 'user', content: 'mi email es cliente@test.com' }],
    }).registerEmails(['cliente@test.com']);
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn().mockResolvedValue({
        id: 'appt-1',
        start: '2026-09-08T10:00:00.000Z',
        end: '2026-09-08T11:00:00.000Z',
        title: 'Appointment with Juan',
        attendeeName: 'Juan Perez',
        attendeeEmail: 'cliente@test.com',
        meetLink: 'https://meet.google.com/xyz',
      }),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-alert' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-sched',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-sched', messages: [] }),
    };

    const tool = new ScheduleAppointmentTool(
      mockCalendar,
      ctx,
      undefined,
      mockEmail,
      internalAlertEmail,
    );

    const result = (await tool.execute({
      start: '2026-09-08T10:00:00.000Z',
      end: '2026-09-08T11:00:00.000Z',
      attendeeName: 'Juan Perez',
      attendeeEmail: 'cliente@test.com',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
        subject: expect.stringContaining('[Synckre Alert] New Appointment: Juan Perez'),
        templateId: RESEND_TEMPLATES.INTERNAL_APPOINTMENT_ES,
      }),
    );
  });

  it('reschedule_appointment envía notificación interna usando plantilla interna dedicada (2cfbae1a-f956-4410-8320-20937fca0d74)', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-resched',
      messages: [{ role: 'user', content: 'cambiar mi cita' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-2',
            start: '2026-09-08T10:00:00.000Z',
            end: '2026-09-08T11:00:00.000Z',
            attendeeName: 'Ana Gomez',
            attendeeEmail: 'ana@test.com',
            meetLink: 'https://meet.google.com/abc',
          },
        ],
      },
    }).registerEmails(['ana@test.com']);
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn().mockResolvedValue({
        id: 'appt-2',
        start: '2026-09-09T14:00:00.000Z',
        end: '2026-09-09T15:00:00.000Z',
        title: 'Appointment with Ana',
        meetLink: 'https://meet.google.com/abc',
      }),
      cancelAppointment: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-resched' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-resched',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-resched', messages: [] }),
    };

    const tool = new RescheduleAppointmentTool(mockCalendar, ctx, mockEmail, internalAlertEmail);

    const result = (await tool.execute({
      start: '2026-09-09T14:00:00.000Z',
      end: '2026-09-09T15:00:00.000Z',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    // Notificación al cliente con plantilla de reagendamiento
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana@test.com',
        templateId: RESEND_TEMPLATES.RESCHEDULE_ES,
      }),
    );
    // Notificación al correo interno con plantilla interna dedicada
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
        subject: expect.stringContaining('[Synckre Alert] Appointment Rescheduled: Ana Gomez'),
        templateId: RESEND_TEMPLATES.INTERNAL_ALERT,
      }),
    );
  });

  it('cancel_appointment envía notificación interna usando plantilla interna dedicada (2cfbae1a-f956-4410-8320-20937fca0d74)', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-cancel',
      messages: [{ role: 'user', content: 'cancelar' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-3',
            start: '2026-09-08T10:00:00.000Z',
            end: '2026-09-08T11:00:00.000Z',
            attendeeName: 'Carlos Ruiz',
            attendeeEmail: 'carlos@test.com',
          },
        ],
      },
    }).registerEmails(['carlos@test.com']);
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn().mockResolvedValue(undefined),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-cancel' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-cancel',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-cancel', messages: [] }),
    };

    const tool = new CancelAppointmentTool(mockCalendar, ctx, mockEmail, internalAlertEmail);

    const result = (await tool.execute({
      reason: 'Viaje imprevisto',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    // Notificación al cliente con plantilla de cancelación
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'carlos@test.com',
        templateId: RESEND_TEMPLATES.CANCEL_ES,
      }),
    );
    // Notificación al correo interno con plantilla interna dedicada
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
        subject: expect.stringContaining('[Synckre Alert] Appointment Cancelled: Carlos Ruiz'),
        templateId: RESEND_TEMPLATES.INTERNAL_ALERT,
      }),
    );
  });

  it('send_email envía correo exclusivamente al cliente y nunca duplica enviando alerta interna', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-mail',
      messages: [{ role: 'user', content: 'contacto@cliente.com' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-4',
            start: '2026-09-08T10:00:00.000Z',
            end: '2026-09-08T11:00:00.000Z',
            attendeeName: 'Laura Sanchez',
            attendeeEmail: 'contacto@cliente.com',
            meetLink: 'https://meet.google.com/xyz',
          },
        ],
      },
    }).registerEmails(['contacto@cliente.com']);
    await memory.save(conv);

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-send' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-mail',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-mail', messages: [] }),
    };

    const tool = new SendEmailTool(mockEmail, ctx, internalAlertEmail);

    const result = (await tool.execute({
      to: 'contacto@cliente.com',
      subject: 'Appointment confirmed',
      body: 'Detalles de tu cita',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    // Notificación al cliente únicamente
    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'contacto@cliente.com',
      }),
    );
    // Verificar que NO se envía alerta duplicada o vacía al correo interno
    expect(mockEmail.send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
      }),
    );
  });

  it('request_human envía alerta interna con plantilla interna dedicada (256c273c-1059-41d4-894e-3b3aaa8aca4a)', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-human',
      messages: [{ role: 'user', content: 'quiero hablar con una persona' }],
    });
    await memory.save(conv);

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-human' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-human',
      maxAppointments: 3,
      memory,
      getState: () => ({
        id: 'conv-human',
        messages: [{ role: 'user', content: 'quiero hablar con una persona' }],
      }),
    };

    const tool = new RequestHumanTool(mockEmail, ctx, internalAlertEmail);

    const result = (await tool.execute({
      reason: 'El cliente solicita atención humana inmediata',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
        templateId: RESEND_TEMPLATES.INTERNAL_ALERT,
      }),
    );
  });

  it('send_internal_alert envía notificación interna usando plantilla oficial de Resend', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-alert-tool',
      messages: [{ role: 'user', content: 'mi correo es vip@enterprise.com' }],
    })
      .registerEmails(['vip@enterprise.com'])
      .bindLead('LEAD-VIP-1');
    await memory.save(conv);

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-internal-alert-1' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-alert-tool',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-alert-tool', messages: [] }),
    };

    const tool = new SendInternalAlertTool(mockEmail, ctx, internalAlertEmail);

    const result = (await tool.execute({
      subject: 'Oportunidad Enterprise detectada',
      message: 'El cliente quiere cotización para 100 usuarios con integración ERP.',
      priority: 'urgent',
    })) as { ok: boolean; status: string; action: string };

    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(result.action).toContain('[URGENT]');
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: internalAlertEmail,
        subject: '[Synckre Alert] [URGENT] Oportunidad Enterprise detectada',
        templateId: RESEND_TEMPLATES.INTERNAL_ALERT,
      }),
    );
  });
});
