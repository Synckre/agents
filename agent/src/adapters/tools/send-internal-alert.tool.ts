import { z } from 'zod';
import { IEmailSender } from '@core/ports/email-sender.port';
import { ITool } from '@core/ports/tool.port';
import { buildInternalAlertTemplatePayload } from '@adapters/email/resend-templates.config';
import { getBoundLeadId, IToolContext, loadConversation } from './tool-context';

const inputSchema = z.object({
  subject: z.string().min(1).describe('Brief subject or headline of the internal alert/notice.'),
  message: z.string().min(1).describe('Detailed information, message, or notes to communicate to the internal team.'),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal').optional().describe('Priority level of the alert.'),
});

export type SendInternalAlertInput = z.infer<typeof inputSchema>;

/**
 * Herramienta para enviar alertas o información al equipo interno usando la plantilla oficial de Resend.
 */
export class SendInternalAlertTool implements ITool {
  readonly name = 'send_internal_alert';
  readonly description =
    'Send an internal alert, notification, or notice to the Synckre team using the official internal template. Use this when the internal team needs to be informed or alerted about a lead, conversation details, or operational notes without necessarily pausing the conversation.';
  readonly schema = inputSchema;

  constructor(
    private readonly email: IEmailSender,
    private readonly ctx: IToolContext,
    private readonly internalAlertEmail: string,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    if (!this.internalAlertEmail) {
      return { ok: false, error: 'INTERNAL_ALERT_EMAIL is not configured.' };
    }

    const conversation = await loadConversation(this.ctx);
    const boundLeadId = getBoundLeadId(conversation);
    const allowedEmails = conversation.getAllowedEmails();
    const clientEmail = allowedEmails.length > 0 ? allowedEmails[allowedEmails.length - 1] : undefined;

    const actionTitle = parsed.data.priority && parsed.data.priority !== 'normal'
      ? `[${parsed.data.priority.toUpperCase()}] ${parsed.data.subject}`
      : parsed.data.subject;

    try {
      const payload = buildInternalAlertTemplatePayload({
        action: actionTitle,
        attendeeName: clientEmail ?? (boundLeadId ? `Lead ${boundLeadId}` : 'Visitor'),
        attendeeEmail: clientEmail,
        notes: parsed.data.message,
        summary: parsed.data.message,
        reason: parsed.data.subject,
        conversationId: this.ctx.conversationId,
        hostName: 'Synckre Team',
      });

      const res = await this.email.send({
        to: this.internalAlertEmail,
        subject: `[Synckre Alert] ${actionTitle}`,
        templateId: payload.templateId,
        variables: payload.variables,
      });

      return {
        ok: true,
        messageId: res.id,
        status: 'sent',
        action: actionTitle,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send internal alert';
      console.error('[send_internal_alert] Error:', message);
      return { ok: false, error: message };
    }
  }
}
