import { z } from 'zod';
import { ICalendar } from '@core/ports/calendar.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ITool } from '@core/ports/tool.port';
import {
  buildCancelTemplatePayload,
  buildInternalAlertTemplatePayload,
} from '@adapters/email/resend-templates.config';
import { generateIcs } from '@adapters/email/ics-generator';
import {
  getBookedAppointments,
  IToolContext,
  loadConversation,
  removeBookedAppointment,
} from './tool-context';

const inputSchema = z.object({
  appointmentId: z.string().optional().describe('ID of the appointment to cancel (must belong to this chat session)'),
  reason: z.string().optional().describe('Reason for cancellation'),
});

export type CancelAppointmentInput = z.infer<typeof inputSchema>;

/**
 * Cancela una cita existente de Google Calendar y ERPNext, restringido estrictamente a las citas
 * agendadas en ESTA conversación (aislamiento de seguridad por sesión).
 * Además, envía automáticamente el correo con la plantilla de cancelación y el .ics con METHOD: CANCEL.
 */
export class CancelAppointmentTool implements ITool {
  readonly name = 'cancel_appointment';
  readonly description =
    'Cancel an existing appointment previously booked in THIS conversation. Never guess an ID from outside this session.';
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

    const conversation = await loadConversation(this.ctx);
    const booked = getBookedAppointments(conversation);

    if (booked.length === 0) {
      return {
        ok: false,
        error: 'No active appointments found in this conversation to cancel.',
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
      await this.calendar.cancelAppointment(targetAppointment.id);
      if (this.appointmentRepo) {
        try {
          await this.appointmentRepo.cancelAppointment(targetAppointment.id);
        } catch (erpErr) {
          console.warn('[cancel_appointment] Could not cancel Appointment in ERPNext:', erpErr);
        }
      }
      await removeBookedAppointment(this.ctx, targetAppointment.id);

      // Cancelar recordatorio automático pendiente asociado a la cita
      if (this.followupScheduler) {
        try {
          await this.followupScheduler.cancelByAppointmentId(targetAppointment.id);
        } catch (schedulerErr) {
          console.warn('[cancel_appointment] Could not cancel automatic reminder:', schedulerErr);
        }
      }

      const start = new Date(targetAppointment.start);
      const end = new Date(targetAppointment.end);

      const allowedEmails = conversation.getAllowedEmails();
      const recipientEmail =
        targetAppointment.attendeeEmail ??
        (allowedEmails.length > 0 ? allowedEmails[allowedEmails.length - 1] : undefined);

      let emailSent = false;
      if (this.email && recipientEmail) {
        try {
          const isEn = conversation.messages.some((m) =>
            m.role === 'user' && /\b(english|cancel|meeting|sorry)\b/i.test(m.content),
          );
          const lang = isEn ? 'en' : 'es';

          const templatePayload = buildCancelTemplatePayload(
            {
              attendeeName: targetAppointment.attendeeName ?? 'Estimado/a cliente',
              start,
              end,
              reason: parsed.data.reason,
              timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
            },
            lang,
          );

          const icsString = generateIcs({
            uid: targetAppointment.id,
            summary: targetAppointment.title ?? 'Appointment with Synckre',
            description: 'Cancelled appointment with Synckre.',
            start,
            end,
            organizerEmail: 'noreply@synckre.com',
            organizerName: 'Synckre',
            attendeeEmail: recipientEmail,
            attendeeName: targetAppointment.attendeeName,
            method: 'CANCEL',
            status: 'CANCELLED',
            sequence: 1,
          });

          await this.email.send({
            to: recipientEmail,
            subject: lang === 'es' ? 'Tu cita ha sido cancelada' : 'Your appointment has been cancelled',
            templateId: templatePayload.templateId,
            variables: templatePayload.variables,
            attachments: [
              {
                filename: 'cancelacion-synckre.ics',
                content: Buffer.from(icsString, 'utf-8').toString('base64'),
                contentType: 'text/calendar; charset=utf-8; method=CANCEL',
              },
            ],
          });
          emailSent = true;
        } catch (emailErr) {
          console.error('[cancel_appointment] Failed to send cancellation email:', emailErr);
        }
      }

      // Notificación automática al correo interno del equipo usando la plantilla oficial interna
      if (this.email && this.internalAlertEmail) {
        try {
          const internalPayload = buildInternalAlertTemplatePayload({
            action: 'Appointment Cancelled',
            attendeeName: targetAppointment.attendeeName ?? 'Client',
            attendeeEmail: recipientEmail,
            start,
            end,
            reason: parsed.data.reason,
            timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
            meetLink: targetAppointment.meetLink,
            conversationId: this.ctx.conversationId,
            hostName: 'Synckre Team',
          });

          await this.email.send({
            to: this.internalAlertEmail,
            subject: `[Synckre Alert] Appointment Cancelled: ${targetAppointment.attendeeName ?? 'Client'}`,
            templateId: internalPayload.templateId,
            variables: internalPayload.variables,
          });
        } catch (alertErr) {
          console.warn('[cancel_appointment] Failed to send internal alert email:', alertErr);
        }
      }

      return {
        ok: true,
        cancelledAppointmentId: targetAppointment.id,
        emailSent,
        message: emailSent
          ? 'Appointment successfully cancelled and cancellation email sent.'
          : 'Appointment successfully cancelled.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancellation failed';
      console.error('[cancel_appointment] Error:', message);
      return { ok: false, error: message };
    }
  }
}

