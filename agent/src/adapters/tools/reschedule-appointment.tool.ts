import { z } from 'zod';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ITool } from '@core/ports/tool.port';
import {
  buildInternalAlertTemplatePayload,
  buildRescheduleTemplatePayload,
  RESEND_TEMPLATES,
} from '@adapters/email/resend-templates.config';
import { generateIcs } from '@adapters/email/ics-generator';
import { resolveAppointmentRange } from './date-resolver';
import {
  getBookedAppointments,
  getBoundLeadId,
  IToolContext,
  loadConversation,
  updateBookedAppointment,
} from './tool-context';

const inputSchema = z.object({
  start: z.string().min(1).describe('ISO-8601 new start time for the appointment'),
  end: z.string().min(1).describe('ISO-8601 new end time for the appointment'),
  appointmentId: z.string().optional().describe('ID of the appointment to reschedule (must belong to this chat session)'),
});

export type RescheduleAppointmentInput = z.infer<typeof inputSchema>;

/**
 * Reprograma una cita existente de Google Calendar y ERPNext, restringido estrictamente a las citas
 * agendadas en ESTA conversación (aislamiento de seguridad por sesión).
 * Además, envía automáticamente el correo con la plantilla de reagendamiento y el .ics actualizado.
 */
export class RescheduleAppointmentTool implements ITool {
  readonly name = 'reschedule_appointment';
  readonly description =
    'Change the date/time of an existing appointment previously booked in THIS conversation. Never guess an ID from outside this session.';
  readonly schema = inputSchema;

  constructor(
    private readonly calendar: ICalendar,
    private readonly ctx: IToolContext,
    private readonly email?: IEmailSender,
    private readonly internalAlertEmail?: string,
    private readonly appointmentRepo?: IAppointmentRepository,
    private readonly followupScheduler?: IFollowupScheduler,
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
    const booked = getBookedAppointments(conversation);

    if (booked.length === 0) {
      return {
        ok: false,
        error: 'No active appointments found in this conversation to reschedule.',
      };
    }

    let targetAppointment = booked[booked.length - 1];
    if (parsed.data.appointmentId) {
      const match = booked.find((a) => a.id === parsed.data.appointmentId);
      if (!match) {
        return {
          ok: false,
          error: 'Security violation: the specified appointment does not belong to this conversation session.',
        };
      }
      targetAppointment = match;
    }

    try {
      const previousStart = new Date(targetAppointment.start);
      const previousEnd = new Date(targetAppointment.end);

      const updated = await this.calendar.rescheduleAppointment(targetAppointment.id, {
        start: range.startIso,
        end: range.endIso,
      });

      if (this.appointmentRepo) {
        try {
          await this.appointmentRepo.rescheduleAppointment(targetAppointment.id, range.startIso);
        } catch (erpErr) {
          console.warn('[reschedule_appointment] Could not reschedule Appointment in ERPNext:', erpErr);
        }
      }

      await updateBookedAppointment(this.ctx, targetAppointment.id, {
        start: updated.start,
        end: updated.end,
      });

      const newStart = new Date(updated.start);
      const newEnd = new Date(updated.end);

      const allowedEmails = conversation.getAllowedEmails();
      const recipientEmail =
        targetAppointment.attendeeEmail ??
        (allowedEmails.length > 0 ? allowedEmails[allowedEmails.length - 1] : undefined);

      const isEn = conversation.messages.some((m) =>
        m.role === 'user' && /\b(english|reschedule|meeting|change)\b/i.test(m.content),
      );
      const lang: 'es' | 'en' = isEn ? 'en' : 'es';

      let emailSent = false;
      if (this.email && recipientEmail) {
        try {
          const templatePayload = buildRescheduleTemplatePayload(
            {
              attendeeName: targetAppointment.attendeeName ?? 'Estimado/a cliente',
              start: newStart,
              end: newEnd,
              previousStart,
              previousEnd,
              timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
              meetLink: updated.meetLink ?? targetAppointment.meetLink,
            },
            lang,
          );

          const icsString = generateIcs({
            uid: targetAppointment.id,
            summary: targetAppointment.title ?? updated.title ?? 'Appointment with Synckre',
            description: 'Appointment rescheduled with Synckre.',
            start: newStart,
            end: newEnd,
            organizerEmail: 'noreply@synckre.com',
            organizerName: 'Synckre',
            attendeeEmail: recipientEmail,
            attendeeName: targetAppointment.attendeeName,
            meetLink: updated.meetLink ?? targetAppointment.meetLink,
            method: 'REQUEST',
            status: 'CONFIRMED',
            sequence: 1,
          });

          await this.email.send({
            to: recipientEmail,
            subject: lang === 'es' ? 'Tu cita ha sido reagendada' : 'Your appointment has been rescheduled',
            templateId: templatePayload.templateId,
            variables: templatePayload.variables,
            attachments: [
              {
                filename: 'invitacion-synckre.ics',
                content: Buffer.from(icsString, 'utf-8').toString('base64'),
                contentType: 'text/calendar; charset=utf-8; method=REQUEST',
              },
            ],
          });
          emailSent = true;
        } catch (emailErr) {
          console.error('[reschedule_appointment] Failed to send reschedule email:', emailErr);
        }
      }

      // Notificación automática al correo interno del equipo usando la plantilla oficial interna
      if (this.email && this.internalAlertEmail) {
        try {
          const internalPayload = buildInternalAlertTemplatePayload({
            action: 'Appointment Rescheduled',
            attendeeName: targetAppointment.attendeeName ?? 'Client',
            attendeeEmail: recipientEmail,
            start: newStart,
            end: newEnd,
            previousStart,
            previousEnd,
            timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
            meetLink: updated.meetLink ?? targetAppointment.meetLink,
            conversationId: this.ctx.conversationId,
            hostName: 'Synckre Team',
          });

          await this.email.send({
            to: this.internalAlertEmail,
            subject: `[Synckre Alert] Appointment Rescheduled: ${targetAppointment.attendeeName ?? 'Client'}`,
            templateId: internalPayload.templateId,
            variables: internalPayload.variables,
          });
        } catch (alertErr) {
          console.warn('[reschedule_appointment] Failed to send internal alert email:', alertErr);
        }
      }

      // Sincronización del recordatorio automático: cancelar el anterior y programar el nuevo
      if (this.followupScheduler) {
        try {
          await this.followupScheduler.cancelByAppointmentId(targetAppointment.id);

          const boundLeadId = getBoundLeadId(conversation);
          if (boundLeadId) {
            const reminderDue = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);
            const now = new Date();
            const scheduledTime = reminderDue > now ? reminderDue : new Date(now.getTime() + 5 * 60 * 1000);

            await this.followupScheduler.schedule({
              leadId: boundLeadId,
              conversationId: this.ctx.conversationId,
              appointmentId: targetAppointment.id,
              dueAt: scheduledTime,
              type: 'reminder',
              action: 'send_template_email',
              templateId: lang === 'en' ? RESEND_TEMPLATES.REMINDER_EN : RESEND_TEMPLATES.REMINDER_ES,
              context: lang === 'en'
                ? `Automatic 24h reminder for rescheduled appointment ${targetAppointment.title ?? updated.title ?? 'Synckre Appointment'} (${updated.start}) with ${targetAppointment.attendeeName ?? 'client'}`
                : `Recordatorio automático 24h antes para la cita reprogramada ${targetAppointment.title ?? updated.title ?? 'Cita Synckre'} (${updated.start}) con ${targetAppointment.attendeeName ?? 'cliente'}`,
              language: lang,
            });
          }
        } catch (schedulerErr) {
          console.warn('[reschedule_appointment] Could not update automatic reminder:', schedulerErr);
        }
      }

      const confirmed = {
        attendeeName: targetAppointment.attendeeName,
        email: recipientEmail,
        start: updated.start,
        end: updated.end,
        date: updated.start.split('T')[0],
        meetLink: updated.meetLink ?? targetAppointment.meetLink,
        previousStart: previousStart.toISOString(),
      };

      return {
        ok: true,
        appointment: updated,
        emailSent,
        confirmed,
        message: emailSent
          ? 'Appointment successfully rescheduled and update email sent.'
          : 'Appointment successfully rescheduled.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Rescheduling failed';
      console.error('[reschedule_appointment] Error:', message);
      return { ok: false, error: message };
    }
  }
}

