import { describe, expect, it, vi } from 'vitest';
import { CheckAvailabilityTool } from '../src/adapters/tools/check-availability.tool';
import { ICalendar } from '../src/core/ports/calendar.port';
import { ISchedulingPolicyProvider } from '../src/core/ports/scheduling-policy.port';
import { IAppointmentRepository } from '../src/core/ports/appointment-repository.port';
import { SchedulingPolicy } from '../src/core/domain/scheduling-policy';

describe('CheckAvailabilityTool', () => {
  const mockPolicy: SchedulingPolicy = {
    timezone: 'America/New_York',
    hoursByWeekday: {
      mon: { open: '09:00', close: '18:00' },
      tue: { open: '09:00', close: '18:00' },
      wed: { open: '09:00', close: '18:00' },
      thu: { open: '09:00', close: '18:00' },
      fri: { open: '09:00', close: '18:00' },
      sat: null,
      sun: null,
    },
    holidays: ['2026-09-07'],
    appointmentTypes: {
      general: { id: 'general', durationMinutes: 30, maxConcurrent: 1 },
      consultation: { id: 'consultation', durationMinutes: 60, maxConcurrent: 1 },
    },
    maxAppointmentsPerDay: 5,
  };

  const mockCalendar: ICalendar = {
    findAvailability: vi.fn(),
    createAppointment: vi.fn(),
    rescheduleAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    listBusyBlocks: vi.fn().mockResolvedValue([
      {
        start: '2026-09-08T13:30:00.000Z',
        end: '2026-09-08T14:00:00.000Z',
      },
    ]),
  };

  const mockPolicyProvider: ISchedulingPolicyProvider = {
    getPolicy: vi.fn().mockResolvedValue(mockPolicy),
  };

  const mockAppointmentRepo: IAppointmentRepository = {
    findAppointments: vi.fn().mockResolvedValue([
      {
        id: 'APPT-1',
        scheduledTime: '2026-09-08T14:30:00.000Z',
        customerName: 'Test',
        status: 'Scheduled',
      },
    ]),
    createAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    rescheduleAppointment: vi.fn(),
  };

  it('calcula slots respetando la política de ERPNext, Google Calendar y citas en ERPNext', async () => {
    const tool = new CheckAvailabilityTool(mockCalendar, mockPolicyProvider, mockAppointmentRepo);

    const result = (await tool.execute({
      start: '2026-09-08T09:00:00',
      end: '2026-09-08T11:00:00',
      appointmentType: 'general',
    })) as { ok: boolean; slots: Array<{ start: string; end: string }>; timezone: string };

    expect(result.ok).toBe(true);
    expect(result.timezone).toBe('America/New_York');

    // De 09:00 a 11:00 EDT (13:00 a 15:00 UTC):
    // 13:00 - 13:30 (libre)
    // 13:30 - 14:00 (ocupado en Google Calendar)
    // 14:00 - 14:30 (libre)
    // 14:30 - 15:00 (ocupado en ERPNext)
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0].start).toBe('2026-09-08T13:00:00.000Z');
    expect(result.slots[1].start).toBe('2026-09-08T14:00:00.000Z');
  });

  it('rechaza inputs inválidos', async () => {
    const tool = new CheckAvailabilityTool(mockCalendar, mockPolicyProvider, mockAppointmentRepo);
    const result = (await tool.execute({ start: '' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
