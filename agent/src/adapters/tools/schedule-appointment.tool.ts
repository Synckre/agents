import { z } from 'zod';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ITool } from '@core/ports/tool.port';
import {
  buildInternalAppointmentTemplatePayload,
  RESEND_TEMPLATES,
} from '../email/resend-templates.config';
import { resolveAppointmentRange } from './date-resolver';
import {
  extractLiteralEmailFromMessages,
  extractLiteralNameFromMessages,
  getAppointmentCount,
  getAllowedEmails,
  getBoundLeadId,
  IToolContext,
  isAllowedEmail,
  loadConversation,
  patchConversation,
} from './tool-context';

const inputSchema = z.object({
  start: z.string().min(1).describe('ISO-8601 start of the appointment'),
  end: z.string().min(1).describe('ISO-8601 end of the appointment'),
  attendeeName: z.string().min(1),
  attendeeEmail: z.string().email().optional(),
  email: z.string().email().optional(),
  appointmentType: z.string().optional().describe('Type of appointment: general, consultation, demo, etc.'),
  notes: z.string().optional(),
  title: z.string().optional(),
});

export type ScheduleAppointmentInput = z.infer<typeof inputSchema>;

/**
 * Crea un evento en Google Calendar y persiste el Appointment en ERPNext,
 * con tope de citas por conversación, programa recordatorio automático y alerta al equipo interno.
 */
export class ScheduleAppointmentTool implements ITool {
  readonly name = 'schedule_appointment';
  readonly description =
    'Create a calendar event for the slot the user chose. Requires attendee name and the chosen start/end. Email, if provided, must be one the user already gave in this conversation.';
  readonly schema = inputSchema;

  constructor(
    private readonly calendar: ICalendar,
    private readonly ctx: IToolContext,
    private readonly followupScheduler?: IFollowupScheduler,
    private readonly email?: IEmailSender,
    private readonly internalAlertEmail?: string,
    private readonly appointmentRepo?: IAppointmentRepository,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    let range: ReturnType<typeof resolveAppointmentRange>;
    try {
      range = resolveAppointmentRange(parsed.data.start, parsed.data.end, {
        allowPast: process.env.NODE_ENV === 'test',
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid appointment range' };
    }

    const conversation = await loadConversation(this.ctx);
    const booked = getAppointmentCount(conversation);
    if (booked >= this.ctx.maxAppointments) {
      return {
        ok: false,
        error: `Appointment limit reached for this conversation (${this.ctx.maxAppointments}).`,
      };
    }

    const rawEmail = parsed.data.attendeeEmail ?? parsed.data.email;
    const verifiedEmail = extractLiteralEmailFromMessages(conversation, rawEmail);
    const verifiedName = extractLiteralNameFromMessages(conversation, parsed.data.attendeeName) ?? parsed.data.attendeeName;

    if (verifiedEmail) {
      const allowed = getAllowedEmails(conversation);
      if (allowed.length > 0 && !isAllowedEmail(conversation, verifiedEmail)) {
        return {
          ok: false,
          error: 'attendeeEmail must match an email the user provided in this conversation.',
        };
      }
    }

    try {
      const appointment = await this.calendar.createAppointment({
        start: range.startIso,
        end: range.endIso,
        attendeeName: verifiedName,
        attendeeEmail: verifiedEmail,
        notes: parsed.data.notes,
        title: parsed.data.title,
      });

      // Persistencia en ERPNext (DocType Appointment vinculado al Lead)
      const boundLeadId = getBoundLeadId(conversation);
      if (this.appointmentRepo) {
        try {
          await this.appointmentRepo.createAppointment({
            scheduledTime: appointment.start,
            customerName: appointment.attendeeName,
            email: verifiedEmail,
            leadId: boundLeadId,
            calendarEventId: appointment.id,
            notes: parsed.data.notes,
            appointmentType: parsed.data.appointmentType,
          });
        } catch (erpError) {
          console.warn('[schedule_appointment] Failed to persist Appointment in ERPNext:', erpError);
        }
      }

      // Mutación atómica en lote: incrementa contador y registra cita en un solo paso
      let count = 1;
      await patchConversation(this.ctx, (conv) => {
        const updated = conv.incrementAppointmentCount().recordAppointment({
          id: appointment.id,
          start: appointment.start,
          end: appointment.end,
          title: appointment.title,
          attendeeName: appointment.attendeeName,
          attendeeEmail: appointment.attendeeEmail,
          meetLink: appointment.meetLink,
        });
        count = updated.getAppointmentCount();
        return updated;
      });

      // Notificación automática al correo interno del equipo usando la plantilla oficial interna
      if (this.email && this.internalAlertEmail) {
        try {
          const internalPayload = buildInternalAppointmentTemplatePayload(
            {
              attendeeName: appointment.attendeeName,
              attendeeEmail: verifiedEmail,
              start: new Date(appointment.start),
              end: new Date(appointment.end),
              timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
              meetLink: appointment.meetLink,
              notes: parsed.data.notes,
            },
            'es',
          );

          await this.email.send({
            to: this.internalAlertEmail,
            subject: `[Synckre Alert] New Appointment: ${appointment.attendeeName}`,
            templateId: internalPayload.templateId,
            variables: internalPayload.variables,
          });
        } catch (alertErr) {
          console.warn('[schedule_appointment] Failed to send internal alert email:', alertErr);
        }
      }

      // Programación automática del recordatorio 24 horas antes de la cita (sin intervención del LLM)
      if (this.followupScheduler) {
        const apptStart = new Date(appointment.start);
        const reminderDue = new Date(apptStart.getTime() - 24 * 60 * 60 * 1000);
        const now = new Date();
        const scheduledTime = reminderDue > now ? reminderDue : new Date(now.getTime() + 5 * 60 * 1000);
        const boundLeadId = getBoundLeadId(conversation);

        if (boundLeadId) {
          try {
            const isEn = conversation.messages.some((m) =>
              m.role === 'user' && /\b(english|appointment|meeting|schedule)\b/i.test(m.content),
            );
            const lang: 'es' | 'en' = isEn ? 'en' : 'es';

            await this.followupScheduler.schedule({
              leadId: boundLeadId,
              conversationId: this.ctx.conversationId,
              appointmentId: appointment.id,
              dueAt: scheduledTime,
              type: 'reminder',
              action: 'send_template_email',
              templateId: lang === 'en' ? RESEND_TEMPLATES.REMINDER_EN : RESEND_TEMPLATES.REMINDER_ES,
              context: lang === 'en'
                ? `Automatic 24h reminder for appointment ${appointment.title} (${appointment.start}) with ${appointment.attendeeName}`
                : `Recordatorio automático 24h antes para la cita ${appointment.title} (${appointment.start}) con ${appointment.attendeeName}`,
              language: lang,
            });
          } catch (err) {
            console.warn('[schedule_appointment] Could not schedule automatic reminder:', err);
          }
        }
      }

      const confirmed = {
        attendeeName: appointment.attendeeName,
        email: verifiedEmail ?? appointment.attendeeEmail,
        start: appointment.start,
        end: appointment.end,
        date: range.startIso.split('T')[0],
        meetLink: appointment.meetLink,
        title: appointment.title,
      };

      return { ok: true, appointment, appointmentCount: count, confirmed };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scheduling failed';
      console.error('[schedule_appointment] Error:', message);
      return { ok: false, error: message };
    }
  }
}
