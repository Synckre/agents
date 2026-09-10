import { z } from 'zod';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ITool } from '@core/ports/tool.port';
import { getBoundLeadId, IToolContext, loadConversation } from './tool-context';

const inputSchema = z
  .object({
    dueAt: z
      .string()
      .min(1)
      .describe('ISO-8601 datetime when the followup or reminder should be executed.'),
    type: z.enum(['followup', 'reminder']).describe('Type of schedule: followup or reminder.'),
    action: z
      .enum(['notify_human', 'send_message', 'send_template_email'])
      .describe('Action to execute: notify_human, send_message, or send_template_email.'),
    context: z
      .string()
      .min(1)
      .describe('Reason, context, or agreements discussed with the user for this followup.'),
    templateId: z.string().optional().describe('Required when action is send_template_email.'),
    language: z.enum(['es', 'en']).default('es').describe('Language of the conversation.'),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'send_template_email' && (!data.templateId || data.templateId.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "templateId is required when action is 'send_template_email'",
        path: ['templateId'],
      });
    }
  });

export type ScheduleFollowupInput = z.infer<typeof inputSchema>;

/**
 * Herramienta para registrar intenciones futuras de seguimiento o recordatorio.
 * El LLM solo registra la intención en la tabla; un worker de cron fijo se encarga de ejecutarla.
 */
export class ScheduleFollowupTool implements ITool {
  readonly name = 'schedule_followup';
  readonly description =
    'Schedule a future followup or reminder for the user. Registers intent in the system; never executes cron infrastructure directly.';
  readonly schema = inputSchema;

  constructor(
    private readonly scheduler: IFollowupScheduler,
    private readonly ctx: IToolContext,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return { ok: false, error: firstIssue?.message ?? parsed.error.message };
    }

    const conversation = await loadConversation(this.ctx);
    const boundLeadId = getBoundLeadId(conversation);

    if (!boundLeadId) {
      return {
        ok: false,
        error: 'No lead is bound to this conversation yet. Please collect contact info and save lead first.',
      };
    }

    const dueAt = new Date(parsed.data.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      return { ok: false, error: 'Invalid dueAt datetime format. Use ISO-8601.' };
    }

    try {
      const followupId = await this.scheduler.schedule({
        leadId: boundLeadId,
        conversationId: this.ctx.conversationId,
        dueAt,
        type: parsed.data.type,
        action: parsed.data.action,
        context: parsed.data.context,
        templateId: parsed.data.templateId,
        language: parsed.data.language,
      });

      return {
        ok: true,
        followupId,
        dueAt: dueAt.toISOString(),
        type: parsed.data.type,
        action: parsed.data.action,
        language: parsed.data.language,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule followup';
      console.error('[schedule_followup] Error:', message);
      return { ok: false, error: message };
    }
  }
}
