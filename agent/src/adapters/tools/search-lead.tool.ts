import { z } from 'zod';
import { ICrm } from '@core/ports/crm.port';
import { ITool } from '@core/ports/tool.port';
import {
  bindLead,
  extractLiteralEmailFromMessages,
  extractLiteralPhoneFromMessages,
  getBoundLeadId,
  IToolContext,
  loadConversation,
  registerEmails,
} from './tool-context';

const inputSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
}).refine((value) => Boolean(value.email || value.phone), {
  message: 'Provide email and/or phone',
});

export type SearchLeadInput = z.infer<typeof inputSchema>;

/**
 * Busca un Lead/Contact en ERPNext. Nunca acepta un ID arbitrario.
 */
export class SearchLeadTool implements ITool {
  readonly name = 'search_lead';
  readonly description =
    'Search ERPNext for an existing Lead/Contact by email and/or phone from this conversation. Use before save_lead to avoid duplicates and recover prior context.';
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

    try {
      if (boundId) {
        const bound = await this.crm.getLeadById(boundId);
        if (!bound) {
          return { ok: false, error: 'The lead bound to this conversation no longer exists.' };
        }
        await registerEmails(this.ctx, [bound.email, verifiedEmail]);
        return { ok: true, lead: bound, bound: true };
      }

      const found = await this.crm.findLead({
        email: verifiedEmail,
        phone: verifiedPhone,
      });

      if (!found) {
        await registerEmails(this.ctx, [verifiedEmail]);
        return { ok: true, lead: null, message: 'No existing lead found for this email/phone.' };
      }

      await bindLead(this.ctx, found.id);
      await registerEmails(this.ctx, [found.email, verifiedEmail]);
      return { ok: true, lead: found, bound: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'CRM search failed' };
    }
  }
}
