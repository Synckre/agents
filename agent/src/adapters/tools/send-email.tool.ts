import { z } from 'zod';
import { IEmailSender } from '@core/ports/email-sender.port';
import { ITool } from '@core/ports/tool.port';
import { generateIcs } from '../email/ics-generator';
import {
  buildClientMessageTemplatePayload,
  buildConfirmationTemplatePayload,
  buildRescheduleTemplatePayload,
} from '../email/resend-templates.config';
import {
  getBookedAppointments,
  IToolContext,
  isAllowedEmail,
  loadConversation,
} from './tool-context';

const inputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export type SendEmailInput = z.infer<typeof inputSchema>;

/**
 * Envía correo vía Resend solo a direcciones aportadas en esta conversación.
 * Si hay una cita agendada en la sesión, aplica la plantilla oficial de Resend
 * y adjunta la invitación interactiva en formato iCalendar (.ics).
 */
export class SendEmailTool implements ITool {
  readonly name = 'send_email';
  readonly description =
    'Send an email (confirmation or short follow-up) to the user. The recipient MUST be an email the user provided in this same conversation.';
  readonly schema = inputSchema;

  constructor(
    private readonly email: IEmailSender,
    private readonly ctx: IToolContext,
    private readonly internalAlertEmail?: string,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    const conversation = await loadConversation(this.ctx);
    if (!isAllowedEmail(conversation, parsed.data.to)) {
      return {
        ok: false,
        error: 'Cannot send email to an address that was not provided by the user in this conversation.',
      };
    }

    const booked = getBookedAppointments(conversation);
    const hasActiveAppointment = booked.length > 0;

    try {
      let resultId = 'unknown';
      let templateUsed: string | undefined;

      if (hasActiveAppointment) {
        const latestAppt = booked[booked.length - 1];
        const start = new Date(latestAppt.start);
        const end = new Date(latestAppt.end);
        const isEnglish = /\b(appointment|confirmed|meeting|thank|details|reschedule)\b/i.test(
          `${parsed.data.subject} ${parsed.data.body}`,
        );
        const lang = isEnglish ? 'en' : 'es';

        const isReschedule = /\b(reprogramad[oa]|reagendad[oa]|reschedul|cambi(ar|o) de fecha)\b/i.test(
          `${parsed.data.subject} ${parsed.data.body}`,
        );

        let templatePayload: { templateId: string; variables: Record<string, string> };

        if (isReschedule) {
          const prevAppt = booked.length > 1 ? booked[booked.length - 2] : latestAppt;
          templatePayload = buildRescheduleTemplatePayload(
            {
              attendeeName: latestAppt.attendeeName ?? 'Estimado/a cliente',
              start,
              end,
              previousStart: new Date(prevAppt.start),
              previousEnd: new Date(prevAppt.end),
              timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
              meetLink: latestAppt.meetLink,
            },
            lang,
          );
          templateUsed = 'reschedule_with_ics';
        } else {
          templatePayload = buildConfirmationTemplatePayload(
            {
              attendeeName: latestAppt.attendeeName ?? 'Estimado/a cliente',
              start,
              end,
              timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York',
              meetLink: latestAppt.meetLink,
            },
            lang,
          );
          templateUsed = 'confirmation_with_ics';
        }

        const icsString = generateIcs({
          uid: latestAppt.id,
          summary: latestAppt.title ?? 'Appointment with Synckre',
          description: isReschedule ? 'Appointment rescheduled with Synckre.' : 'Appointment confirmed with Synckre.',
          start,
          end,
          organizerEmail: 'noreply@synckre.com',
          organizerName: 'Synckre',
          attendeeEmail: parsed.data.to,
          attendeeName: latestAppt.attendeeName,
          meetLink: latestAppt.meetLink,
          method: 'REQUEST',
          status: 'CONFIRMED',
          sequence: isReschedule ? 1 : 0,
        });

        const result = await this.email.send({
          to: parsed.data.to,
          subject: parsed.data.subject,
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
        resultId = result.id;
      } else {
        const isEnglish = /\b(appointment|confirmed|meeting|thank|details|reschedule|hello|hi)\b/i.test(
          `${parsed.data.subject} ${parsed.data.body}`,
        );
        const templatePayload = buildClientMessageTemplatePayload(
          {
            title: parsed.data.subject,
            message: parsed.data.body,
          },
          isEnglish ? 'en' : 'es',
        );
        const result = await this.email.send({
          to: parsed.data.to,
          subject: parsed.data.subject,
          templateId: templatePayload.templateId,
          variables: templatePayload.variables,
        });
        resultId = result.id;
        templateUsed = 'client_message';
      }

      return {
        ok: true,
        id: resultId,
        confirmed: {
          to: parsed.data.to,
          subject: parsed.data.subject,
        },
        ...(templateUsed ? { template: templateUsed } : {}),
      };
    } catch (error) {
      console.error('[send_email] Error:', error);
      return { ok: false, error: error instanceof Error ? error.message : 'Email send failed' };
    }
  }
}
