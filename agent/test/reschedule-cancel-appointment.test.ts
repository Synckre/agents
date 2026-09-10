import { describe, expect, it, vi } from 'vitest';
import { RescheduleAppointmentTool } from '@adapters/tools/reschedule-appointment.tool';
import { CancelAppointmentTool } from '@adapters/tools/cancel-appointment.tool';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IToolContext } from '@adapters/tools/tool-context';
import { Conversation } from '@core/domain/conversation.entity';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { RESEND_TEMPLATES } from '@adapters/email/resend-templates.config';

describe('Reschedule and Cancel Appointment automatic emails with ICS', () => {
  it('reschedule_appointment envía correo automático de reagendamiento con .ics actualizado', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-reschedule',
      messages: [{ role: 'user', content: 'hola, reagendar' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-123',
            start: '2026-09-05T14:00:00.000Z',
            end: '2026-09-05T15:00:00.000Z',
            attendeeName: 'Carlos Dev',
            attendeeEmail: 'carlos@test.com',
            meetLink: 'https://meet.google.com/xyz',
          },
        ],
      },
    }).registerEmails(['carlos@test.com']);
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn().mockResolvedValue({
        id: 'appt-123',
        start: '2026-09-06T16:00:00.000Z',
        end: '2026-09-06T17:00:00.000Z',
        meetLink: 'https://meet.google.com/xyz',
      }),
      cancelAppointment: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-rescheduled' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-reschedule',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-reschedule', messages: [] }),
    };

    const tool = new RescheduleAppointmentTool(mockCalendar, ctx, mockEmail);
    const result = (await tool.execute({
      start: '2026-09-06T16:00:00.000Z',
      end: '2026-09-06T17:00:00.000Z',
    })) as { ok: boolean; emailSent: boolean };

    expect(result.ok).toBe(true);
    expect(result.emailSent).toBe(true);
    expect(mockCalendar.rescheduleAppointment).toHaveBeenCalled();
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'carlos@test.com',
        templateId: RESEND_TEMPLATES.RESCHEDULE_ES,
        variables: expect.objectContaining({
          PREVIOUS_DATE: expect.any(String),
          DATE: expect.any(String),
        }),
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: 'invitacion-synckre.ics',
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          }),
        ]),
      }),
    );
  });

  it('cancel_appointment envía correo automático de cancelación con .ics METHOD:CANCEL', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-cancel',
      messages: [{ role: 'user', content: 'cancelar mi cita por favor' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-456',
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
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn().mockResolvedValue(undefined),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-cancelled' }),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-cancel',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-cancel', messages: [] }),
    };

    const tool = new CancelAppointmentTool(mockCalendar, ctx, mockEmail);
    const result = (await tool.execute({
      reason: 'No puedo asistir',
    })) as { ok: boolean; emailSent: boolean };

    expect(result.ok).toBe(true);
    expect(result.emailSent).toBe(true);
    expect(mockCalendar.cancelAppointment).toHaveBeenCalledWith('appt-456');
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ana@test.com',
        templateId: RESEND_TEMPLATES.CANCEL_ES,
        variables: expect.objectContaining({
          REASON: 'No puedo asistir',
          DATE: expect.any(String),
        }),
        attachments: expect.arrayContaining([
          expect.objectContaining({
            filename: 'cancelacion-synckre.ics',
            contentType: 'text/calendar; charset=utf-8; method=CANCEL',
          }),
        ]),
      }),
    );
  });

  it('cancel_appointment cancela el recordatorio automático en el scheduler', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-cancel-reminder',
      messages: [{ role: 'user', content: 'cancelar mi cita' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-999',
            start: '2026-09-15T10:00:00.000Z',
            end: '2026-09-15T11:00:00.000Z',
            attendeeName: 'Pedro Test',
            attendeeEmail: 'pedro@test.com',
          },
        ],
      },
    }).bindLead('LEAD-999');
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn().mockResolvedValue(undefined),
    };

    const mockScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
      cancelByAppointmentId: vi.fn().mockResolvedValue(undefined),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-cancel-reminder',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-cancel-reminder', messages: [] }),
    };

    const tool = new CancelAppointmentTool(
      mockCalendar,
      ctx,
      undefined,
      undefined,
      undefined,
      mockScheduler,
    );

    const result = (await tool.execute({})) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockScheduler.cancelByAppointmentId).toHaveBeenCalledWith('appt-999');
  });

  it('reschedule_appointment cancela el recordatorio anterior y programa el nuevo en el scheduler', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'conv-reschedule-reminder',
      messages: [{ role: 'user', content: 'quiero reprogramar' }],
      metadata: {
        bookedAppointments: [
          {
            id: 'appt-888',
            start: '2026-09-12T14:00:00.000Z',
            end: '2026-09-12T15:00:00.000Z',
            title: 'Sesión Consultoría',
            attendeeName: 'Laura Dev',
            attendeeEmail: 'laura@test.com',
          },
        ],
      },
    }).bindLead('LEAD-888');
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn().mockResolvedValue({
        id: 'appt-888',
        start: '2026-09-20T16:00:00.000Z',
        end: '2026-09-20T17:00:00.000Z',
        title: 'Sesión Consultoría',
      }),
      cancelAppointment: vi.fn(),
    };

    const mockScheduler = {
      schedule: vi.fn().mockResolvedValue('new-reminder-id'),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
      cancelByAppointmentId: vi.fn().mockResolvedValue(undefined),
    };

    const ctx: IToolContext = {
      conversationId: 'conv-reschedule-reminder',
      maxAppointments: 3,
      memory,
      getState: () => ({ id: 'conv-reschedule-reminder', messages: [] }),
    };

    const tool = new RescheduleAppointmentTool(
      mockCalendar,
      ctx,
      undefined,
      undefined,
      undefined,
      mockScheduler,
    );

    const result = (await tool.execute({
      start: '2026-09-20T16:00:00.000Z',
      end: '2026-09-20T17:00:00.000Z',
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(mockScheduler.cancelByAppointmentId).toHaveBeenCalledWith('appt-888');
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'LEAD-888',
        conversationId: 'conv-reschedule-reminder',
        appointmentId: 'appt-888',
        dueAt: new Date('2026-09-19T16:00:00.000Z'), // 24h antes del 20 de septiembre a las 16:00
        type: 'reminder',
        action: 'send_template_email',
        templateId: RESEND_TEMPLATES.REMINDER_ES,
      }),
    );
  });
});
