import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import {
  buildClientMessageTemplatePayload,
  buildInternalAlertTemplatePayload,
} from '@adapters/email/resend-templates.config';

export interface WebsiteContactInput {
  readonly name: string;
  readonly email: string;
  readonly message: string;
  readonly company?: string;
  readonly phone?: string;
  readonly topic?: string;
  readonly locale?: 'en' | 'es';
}

export interface WebsiteContactResult {
  readonly ok: true;
  readonly leadId: string;
  readonly action: 'created' | 'updated';
  readonly emails: {
    readonly client: boolean;
    readonly internal: boolean;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trim(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

export function parseWebsiteContactInput(body: unknown): WebsiteContactInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid JSON body' };
  }
  const data = body as Record<string, unknown>;
  const firstName = trim(data.firstName, 80);
  const lastName = trim(data.lastName, 80);
  const combinedName = [firstName, lastName].filter(Boolean).join(' ');
  const name = trim(data.name, 160) || combinedName;
  const email = trim(data.email, 254).toLowerCase();
  const message = trim(data.message, 8000);
  const company = trim(data.company, 160);
  const phone = trim(data.phone, 40);
  const topic = trim(data.topic, 80) || trim(data.service, 80);
  const locale = data.locale === 'en' || data.locale === 'es' ? data.locale : undefined;

  if (!name) return { error: "Field 'name' is required." };
  if (!email || !EMAIL_RE.test(email)) return { error: "Field 'email' is required and must be valid." };
  if (!message) return { error: "Field 'message' is required." };

  return {
    name,
    email,
    message,
    ...(company ? { company } : {}),
    ...(phone ? { phone } : {}),
    ...(topic ? { topic } : {}),
    ...(locale ? { locale } : {}),
  };
}

function noteFrom(input: WebsiteContactInput): string {
  const lines = [
    'Website contact form',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.company ? `Company: ${input.company}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    input.topic ? `Topic: ${input.topic}` : null,
    '',
    input.message,
  ];
  return lines.filter((line) => line !== null).join('\n');
}

export class ProcessWebsiteContactUseCase {
  constructor(
    private readonly crm: ICrm,
    private readonly email: IEmailSender,
    private readonly internalAlertEmail: string,
  ) {}

  async execute(input: WebsiteContactInput): Promise<WebsiteContactResult> {
    const existing = await this.crm.findLead({
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
    });

    const fields = {
      name: input.name,
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
      data: {
        source: 'Website',
        ...(input.company ? { company_name: input.company } : {}),
      },
    };

    let leadId: string;
    let action: 'created' | 'updated';

    if (existing?.id) {
      const updated = await this.crm.updateLead(existing.id, fields);
      leadId = updated.id;
      action = 'updated';
    } else {
      const created = await this.crm.createLead({
        ...fields,
        data: {
          ...fields.data,
          notes: noteFrom(input),
        },
      });
      leadId = created.id;
      action = 'created';
    }

    if (action === 'updated') {
      await this.crm.appendLeadNote(leadId, noteFrom(input));
    }

    const lang = input.locale === 'en' ? 'en' : 'es';
    const emails = { client: false, internal: false };

    try {
      const client = buildClientMessageTemplatePayload(
        {
          title: lang === 'es' ? 'Hemos recibido su mensaje' : 'We received your message',
          message:
            lang === 'es'
              ? `Hola ${input.name},\n\nGracias por escribir a Synckre. Hemos registrado su consulta y el equipo responderá a ${input.email}.`
              : `Hello ${input.name},\n\nThank you for contacting Synckre. We logged your inquiry and the team will reply at ${input.email}.`,
          ctaLink: 'https://www.synckre.com/contact',
          ctaText: lang === 'es' ? 'Contactar de nuevo' : 'Contact again',
        },
        lang,
      );
      await this.email.send({
        to: input.email,
        subject: lang === 'es' ? 'Synckre ha recibido su mensaje' : 'Synckre received your message',
        templateId: client.templateId,
        variables: client.variables,
      });
      emails.client = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[website_contact] client email failed:', message);
    }

    if (this.internalAlertEmail) {
      try {
        const alert = buildInternalAlertTemplatePayload({
          action: 'Website contact form',
          attendeeName: input.name,
          attendeeEmail: input.email,
          notes: noteFrom(input),
          summary: `${input.name} (${input.email}) submitted the website form.`,
          reason: input.topic || 'Website form',
          conversationId: `form:${leadId}`,
          hostName: 'Synckre Team',
        });
        await this.email.send({
          to: this.internalAlertEmail,
          subject: `[Synckre Alert] Website form — ${input.name}`,
          templateId: alert.templateId,
          variables: alert.variables,
        });
        emails.internal = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[website_contact] internal alert failed:', message);
      }
    }

    return { ok: true, leadId, action, emails };
  }
}
