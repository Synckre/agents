import { z } from 'zod';
import { Conversation } from '@core/domain/conversation.entity';
import { IEmailSender } from '@core/ports/email-sender.port';
import { ITool } from '@core/ports/tool.port';
import { buildInternalAlertTemplatePayload } from '@adapters/email/resend-templates.config';
import { IToolContext, loadConversation, patchConversation } from './tool-context';

const inputSchema = z.object({
  reason: z.string().min(1).describe('Why a human needs to take over'),
  summary: z.string().optional().describe('Short summary of the conversation so far'),
});

export type RequestHumanInput = z.infer<typeof inputSchema>;

/**
 * Pausa la conversación, persiste el estado y alerta internamente por correo.
 */
export class RequestHumanTool implements ITool {
  readonly name = 'request_human';
  readonly description =
    'Escalate to a human. Pauses this conversation (no further automatic replies), stores the paused state, and emails the internal team with the history and reason.';
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
      return { ok: false, error: 'INTERNAL_ALERT_EMAIL is not configured' };
    }

    const state = this.ctx.getState();
    const current = await loadConversation(this.ctx);
    const withHistory = current.withMessages(state.messages);
    const history = formatHistory(withHistory);
    const summary = parsed.data.summary ?? truncated(history, 1500);

    const boundLeadId = current.getBoundLeadId();
    const allowedEmails = current.getAllowedEmails();
    const clientEmail = allowedEmails.length > 0 ? allowedEmails[allowedEmails.length - 1] : undefined;

    const payload = buildInternalAlertTemplatePayload({
      action: 'Human Escalation Required',
      reason: parsed.data.reason,
      summary,
      notes: `Reason: ${parsed.data.reason}`,
      attendeeName: clientEmail ?? (boundLeadId ? `Lead ${boundLeadId}` : 'Visitor'),
      attendeeEmail: clientEmail,
      conversationId: this.ctx.conversationId,
      hostName: 'Synckre Team',
    });

    try {
      await this.email.send({
        to: this.internalAlertEmail,
        subject: `[Synckre Alert] Escalation — conversation ${this.ctx.conversationId}`,
        templateId: payload.templateId,
        variables: payload.variables,
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to send internal alert',
      };
    }

    const paused = await patchConversation(this.ctx, () => withHistory.pauseForHuman());

    return {
      ok: true,
      status: paused.status,
      message: 'Conversation paused. Inform the user that a human will follow up, then stop.',
    };
  }
}

function formatHistory(conversation: Conversation): string {
  return conversation.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n');
}

function truncated(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

