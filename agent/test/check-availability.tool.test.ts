import { describe, expect, it, vi } from 'vitest';
import { CheckAvailabilityTool } from '../src/adapters/tools/check-availability.tool';
import { ICalendar } from '../src/core/ports/calendar.port';
import { ISchedulingPolicyProvider } from '../src/core/ports/scheduling-policy.port';
import { IAppointmentRepository } from '../src/core/ports/appointment-repository.port';
import { SchedulingPolicy } from '../src/core/domain/scheduling-policy';

const TIMEZONE = 'America/New_York';

/**
 * El test original fijaba el 2026-09-08. Al quedar esa fecha en el pasado,
 * `resolveAppointmentRange` rechazaba el rango y el caso dejaba de probar el
 * cálculo de slots. Ahora la ventana se calcula a partir de una fecha futura
 * y los valores esperados se derivan de ella, no de literales.
 */
function nextWeekday(weekday: number): { dateLabel: string; dateKey: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  // Avanza al menos una semana para que no colisione con el día actual.
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== weekday) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const dateKey = d.toISOString().slice(0, 10);
  return { dateLabel: `${dateKey}T09:00:00`, dateKey };
}

describe('CheckAvailabilityTool', () => {
  const mockPolicy: SchedulingPolicy = {
    timezone: TIMEZONE,
    hoursByWeekday: {
      mon: { open: '09:00', close: '18:00' },
      tue: { open: '09:00', close: '18:00' },
      wed: { open: '09:00', close: '18:00' },
      thu: { open: '09:00', close: '18:00' },
      fri: { open: '09:00', close: '18:00' },
      sat: null,
      sun: null,
    },
    holidays: [],
    appointmentTypes: {
      general: { id: 'general', durationMinutes: 30, maxConcurrent: 1 },
      consultation: { id: 'consultation', durationMinutes: 60, maxConcurrent: 1 },
    },
    maxAppointmentsPerDay: 5,
  };

  it('calcula slots respetando la política configurada, Google Calendar y las citas del CRM', async () => {
    // Lunes futuro. 09:00 hora de Nueva York = 13:00 UTC (EDT, UTC-4).
    const { dateLabel } = nextWeekday(1);
    const windowStartUtc = new Date(`${dateLabel}-04:00`);
    const toUtc = (offsetMinutes: number) =>
      new Date(windowStartUtc.getTime() + offsetMinutes * 60_000).toISOString();

    // Ocupado 30' en el calendario a los 30' del inicio; cita del CRM a los 90'.
    const calendarBusyStart = toUtc(30);
    const calendarBusyEnd = toUtc(60);
    const crmAppointmentStart = toUtc(90);

    const mockCalendar: ICalendar = {
      findAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
      listBusyBlocks: vi.fn().mockResolvedValue([
        { start: calendarBusyStart, end: calendarBusyEnd },
      ]),
    };

    const mockPolicyProvider: ISchedulingPolicyProvider = {
      getPolicy: vi.fn().mockResolvedValue(mockPolicy),
    };

    const mockAppointmentRepo: IAppointmentRepository = {
      findAppointments: vi.fn().mockResolvedValue([
        {
          id: 'APPT-1',
          scheduledTime: crmAppointmentStart,
          customerName: 'Test',
          status: 'Scheduled',
        },
      ]),
      createAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
    };

    const tool = new CheckAvailabilityTool(mockCalendar, mockPolicyProvider, mockAppointmentRepo);

    const result = (await tool.execute({
      start: dateLabel,
      end: `${dateLabel.slice(0, 10)}T11:00:00`,
      appointmentType: 'general',
    })) as { ok: boolean; slots: Array<{ start: string; end: string }>; timezone: string };

    expect(result.ok).toBe(true);
    expect(result.timezone).toBe(TIMEZONE);

    // Ventana de 2h en bloques de 30': dos quedan ocupados (calendario y CRM).
    expect(result.slots).toHaveLength(2);

    // Los slots devueltos nunca deben solaparse con los bloques ocupados.
    const busy = [
      { start: calendarBusyStart, end: calendarBusyEnd },
      { start: crmAppointmentStart, end: toUtc(120) },
    ];
    for (const slot of result.slots) {
      for (const block of busy) {
        const overlaps =
          new Date(slot.start).getTime() < new Date(block.end).getTime() &&
          new Date(block.start).getTime() < new Date(slot.end).getTime();
        expect(overlaps).toBe(false);
      }
    }
  });

  it('rechaza inputs inválidos', async () => {
    const mockCalendar = {
      findAvailability: vi.fn(),
      createAppointment: vi.fn(),
      rescheduleAppointment: vi.fn(),
      cancelAppointment: vi.fn(),
    } as unknown as ICalendar;
    const tool = new CheckAvailabilityTool(mockCalendar);
    const result = (await tool.execute({ start: '' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
