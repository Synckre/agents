import { describe, expect, it, vi } from 'vitest';
import { ScheduleAppointmentTool } from '@adapters/tools/schedule-appointment.tool';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IToolContext } from '@adapters/tools/tool-context';
import { Conversation } from '@core/domain/conversation.entity';
import { ICalendar } from '@core/ports/calendar.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';

describe('ScheduleAppointmentTool automatic 24h reminder', () => {
  it('agenda automáticamente un recordatorio 24 horas antes sin intervención del LLM', async () => {
    const memory = new InMemoryStore();
    const conv = new Conversation({
      id: 'c1',
      messages: [{ role: 'user', content: 'mi correo es test@synckre.com' }],
    })
      .registerEmails(['test@synckre.com'])
      .bindLead('LEAD-300');
    await memory.save(conv);

    const mockCalendar: ICalendar = {
      checkAvailability: vi.fn(),
      createAppointment: vi.fn().mockResolvedValue({
        id: 'appt-100',
        start: '2026-09-10T14:00:00.000Z',
        end: '2026-09-10T15:00:00.000Z',
        title: 'Demo Synckre',
        attendeeName: 'Carlos Test',
        attendeeEmail: 'test@synckre.com',
        meetLink: 'https://meet.google.com/test-link',
      }),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
    };

    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn().mockResolvedValue('reminder-f-1'),
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

    const tool = new ScheduleAppointmentTool(mockCalendar, ctx, mockScheduler);

    const res = await tool.execute({
      start: '2026-09-10T14:00:00.000Z',
      end: '2026-09-10T15:00:00.000Z',
      attendeeName: 'Carlos Test',
      attendeeEmail: 'test@synckre.com',
      title: 'Demo Synckre',
    });

    expect(res).toMatchObject({ ok: true });
    expect(mockCalendar.createAppointment).toHaveBeenCalled();

    // Verifica que se programó el recordatorio automáticamente sin que el LLM lo pida
    expect(mockScheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'LEAD-300',
        conversationId: 'c1',
        appointmentId: 'appt-100',
        type: 'reminder',
        action: 'send_template_email',
        templateId: expect.any(String),
      }),
    );
  });
});
