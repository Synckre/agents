import { z } from 'zod';
import { ICalendar } from '@core/ports/calendar.port';
import { ITool } from '@core/ports/tool.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { DEFAULT_SCHEDULING_POLICY } from '@config/scheduling-policy';
import {
  computeAvailableSlots,
  ExistingBooking,
} from '@core/domain/scheduling/compute-available-slots';
import { resolveAppointmentRange } from './date-resolver';

const inputSchema = z.object({
  start: z.string().min(1).describe('ISO-8601 start of the search window'),
  end: z.string().min(1).describe('ISO-8601 end of the search window'),
  appointmentType: z
    .string()
    .optional()
    .describe('Type of appointment: general, consultation, demo, etc.'),
  slotMinutes: z.number().int().positive().max(240).optional(),
});

export type CheckAvailabilityInput = z.infer<typeof inputSchema>;

/**
 * Consulta horarios disponibles reales orquestando:
 * 1. Política de agendamiento y horarios comerciales de ERPNext (o fallback).
 * 2. Eventos ocupados en Google Calendar.
 * 3. Citas agendadas en ERPNext.
 * 4. Cálculo determinista puro en core/domain (computeAvailableSlots).
 */
export class CheckAvailabilityTool implements ITool {
  readonly name = 'check_availability';
  readonly description =
    'Check real available time slots for a date/time window. The tool applies company business hours, holidays, and existing bookings automatically. Always use the returned slots as the single source of truth.';
  readonly schema = inputSchema;

  constructor(
    private readonly calendar: ICalendar,
    private readonly policyProvider?: ISchedulingPolicyProvider,
    private readonly appointmentRepo?: IAppointmentRepository,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    try {
      const range = resolveAppointmentRange(parsed.data.start, parsed.data.end);

      // 1. Obtener la política (ERPNext Appointment Booking Settings / Holiday List o default)
      const policy = this.policyProvider
        ? await this.policyProvider.getPolicy()
        : DEFAULT_SCHEDULING_POLICY;

      // 2. Obtener bloques ocupados de Google Calendar
      let calendarBusy: Array<{ start: string; end: string }> = [];
      try {
        if (this.calendar.listBusyBlocks) {
          calendarBusy = await this.calendar.listBusyBlocks({
            start: range.startIso,
            end: range.endIso,
          });
        }
      } catch (calError) {
        console.warn('[check_availability] Failed to query Google Calendar busy blocks:', calError);
      }

      // 3. Obtener citas agendadas en ERPNext (DocType Appointment)
      let erpAppointments: ExistingBooking[] = [];
      if (this.appointmentRepo) {
        try {
          const records = await this.appointmentRepo.findAppointments(range.startIso, range.endIso);
          erpAppointments = records.map((r) => {
            const startMs = new Date(r.scheduledTime).getTime();
            const durationMs = (policy.appointmentTypes[r.appointmentType ?? 'general']?.durationMinutes ?? 30) * 60_000;
            return {
              start: new Date(startMs).toISOString(),
              end: new Date(startMs + durationMs).toISOString(),
              type: r.appointmentType,
            };
          });
        } catch (erpError) {
          console.warn('[check_availability] Failed to query ERPNext appointments:', erpError);
        }
      }

      // 4. Calcular slots disponibles determinísticamente sin I/O en la capa de dominio
      const existingBookings: ExistingBooking[] = [...calendarBusy, ...erpAppointments];
      const slots = computeAvailableSlots(
        policy,
        existingBookings,
        { from: range.startIso, to: range.endIso },
        parsed.data.appointmentType,
      );

      return {
        ok: true,
        slots,
        timezone: policy.timezone,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Availability lookup failed';
      console.error('[check_availability] Error:', message);
      return { ok: false, error: message };
    }
  }
}
