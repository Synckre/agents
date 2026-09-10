import { z } from 'zod';
import { ICrm } from '@core/ports/crm.port';
import { ITool } from '@core/ports/tool.port';
import { getBoundLeadId, IToolContext, loadConversation } from './tool-context';

const inputSchema = z.object({
  note: z.string().min(1).describe('Summary of the conversation, user needs, budget, or key agreements to save in CRM.'),
});

export type AppendLeadNoteInput = z.infer<typeof inputSchema>;

/**
 * Agrega notas en segundo plano a la ficha del Lead en ERPNext CRM.
 * Opera estrictamente sobre el Lead vinculado a esta conversación.
 */
export class AppendLeadNoteTool implements ITool {
  readonly name = 'append_lead_note';
  readonly description =
    'Append a summary note to the CRM Lead bound to this conversation (e.g. user requirements, discussion summary, special requests). Runs in the background without disturbing the user.';
  readonly schema = inputSchema;

  constructor(
    private readonly crm: ICrm,
    private readonly ctx: IToolContext,
  ) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    const conversation = await loadConversation(this.ctx);
    const boundLeadId = getBoundLeadId(conversation);

    if (!boundLeadId) {
      return {
        ok: false,
        error: 'No lead is currently bound to this conversation. Please save or search the lead first.',
      };
    }

    try {
      await this.crm.appendLeadNote(boundLeadId, parsed.data.note);
      return {
        ok: true,
        leadId: boundLeadId,
        message: 'Note successfully saved to ERPNext CRM lead.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to append note to CRM';
      console.error('[append_lead_note] Error:', message);
      return { ok: false, error: message };
    }
  }
}
