import { z } from 'zod';
import { ICrm } from '@core/ports/crm.port';
import { ITool } from '@core/ports/tool.port';
import {
  bindLead,
  extractLiteralEmailFromMessages,
  extractLiteralNameFromMessages,
  extractLiteralPhoneFromMessages,
  getBoundLeadId,
  IToolContext,
  loadConversation,
  registerEmails,
} from './tool-context';

const inputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  notes: z.string().optional(),
  company: z.string().optional(),
});

export type SaveLeadInput = z.infer<typeof inputSchema>;

/**
 * Crea o actualiza únicamente el lead asociado a la conversación actual.
 */
export class SaveLeadTool implements ITool {
  readonly name = 'save_lead';
  readonly description =
    'Create or update the Lead/Contact in ERPNext for THIS conversation only. Collect name, email and phone in normal chat first, then call this tool. Never pass an arbitrary lead id.';
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
    const boundId = getBoundLeadId(conversation);
    const verifiedEmail = extractLiteralEmailFromMessages(conversation, parsed.data.email);
    const verifiedPhone = extractLiteralPhoneFromMessages(conversation, parsed.data.phone);
    const verifiedName = extractLiteralNameFromMessages(conversation, parsed.data.name) ?? parsed.data.name;

    const draft = {
      name: verifiedName,
      email: verifiedEmail,
      phone: verifiedPhone,
      data: {
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.company ? { company_name: parsed.data.company } : {}),
      },
    };

    const confirmed = {
      name: verifiedName,
      email: verifiedEmail,
      phone: verifiedPhone,
      company: parsed.data.company,
    };

    try {
      if (boundId) {
        const updated = await this.crm.updateLead(boundId, draft);
        await registerEmails(this.ctx, [updated.email, verifiedEmail]);
        return { ok: true, lead: updated, action: 'updated', confirmed };
      }

      const created = await this.crm.createLead(draft);
      await bindLead(this.ctx, created.id);
      await registerEmails(this.ctx, [created.email, verifiedEmail]);
      return { ok: true, lead: created, action: 'created', confirmed };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'CRM save failed';
      console.error('[save_lead] Error:', message);
      return { ok: false, error: message };
    }
  }
}
