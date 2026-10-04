import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import {
  buildClientMessageTemplatePayload,
  buildInternalAlertTemplatePayload,
} from '@adapters/email/resend-templates.config';
import {
  buildWebsiteContactAck,
  SYNCKRE_CONTACT_EMAIL,
} from '@core/domain/website-contact-ack';

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
  /** false si el CRM no llegó a persistir nada (el leadId es solo un marcador). */
  readonly crmPersisted: boolean;
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
    const fields = {
      name: input.name,
      ...(input.company ? { companyName: input.company } : {}),
      email: input.email,
      ...(input.phone ? { phone: input.phone } : {}),
      source: 'Website',
      notes: noteFrom(input),
      data: {
        source: 'Website',
        ...(input.company ? { company_name: input.company } : {}),
        ...(input.topic ? { topic: input.topic } : {}),
        // El mensaje crudo del cliente se guarda además en el campo nativo
        // `message` del contacto: es visible en la vista estándar de HubSpot y
        // no depende de ninguna propiedad personalizada.
        message: input.message,
      },
    };

    let leadId = `web-${Date.now()}`;
    let action: 'created' | 'updated' = 'created';
    let crmPersisted = false;

    try {
      const existing = await this.crm.findLead({
        email: input.email,
        ...(input.phone ? { phone: input.phone } : {}),
      });

      if (existing?.id) {
        const updated = await this.crm.updateLead(existing.id, fields);
        leadId = updated.id;
        action = 'updated';
      } else {
        const created = await this.crm.createLead(fields);
        leadId = created.id;
        action = 'created';
      }

      crmPersisted = true;

      // En un alta, la nota viaja dentro de `fields.notes` y el adaptador la
      // registra al crear. Sólo en una actualización hay que añadirla aparte.
      if (action === 'updated') {
        await this.crm.appendLeadNote(leadId, noteFrom(input));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[website_contact] CRM lead creation failed (proceeding to send notification emails):', message);
    }

    const emails = { client: false, internal: false };

    // El acuse se envía en el idioma en el que el cliente rellenó el formulario.
    const locale: 'es' | 'en' = input.locale === 'en' ? 'en' : 'es';

    try {
      const ack = buildWebsiteContactAck(
        {
          name: input.name,
          email: input.email,
          ...(input.company ? { company: input.company } : {}),
          ...(input.topic ? { topic: input.topic } : {}),
        },
        locale,
      );

      const client = buildClientMessageTemplatePayload(
        {
          title: ack.title,
          message: ack.message,
          ctaLink: ack.ctaLink,
          ctaText: ack.ctaText,
        },
        locale,
      );

      await this.email.send({
        to: input.email,
        from: `Synckre <${SYNCKRE_CONTACT_EMAIL}>`,
        replyTo: SYNCKRE_CONTACT_EMAIL,
        subject: ack.subject,
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
        const detailsLines = [
          `• Cliente: ${input.name}`,
          `• Correo: ${input.email}`,
          input.company ? `• Empresa: ${input.company}` : null,
          input.phone ? `• Teléfono: ${input.phone}` : null,
          input.topic ? `• Asunto / Servicio: ${input.topic}` : null,
          '',
          `• Mensaje del cliente:\n"${input.message}"`,
        ]
          .filter((line) => line !== null)
          .join('\n');

        const alert = buildInternalAlertTemplatePayload({
          action: 'Nuevo mensaje de contacto web',
          attendeeName: input.name,
          attendeeEmail: input.email,
          customDetails: detailsLines,
          summary: `${input.name} (${input.email}) ha enviado un mensaje desde el formulario web de synckre.com.`,
          conversationId: `form:${leadId}`,
          hostName: 'Equipo Synckre',
        });
        await this.email.send({
          to: this.internalAlertEmail,
          from: 'Synckre <customer@synckre.com>',
          replyTo: input.email,
          subject: `[Synckre] Nuevo contacto web — ${input.name}`,
          templateId: alert.templateId,
          variables: alert.variables,
        });
        emails.internal = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[website_contact] internal alert failed:', message);
      }
    }

    // Si no se pudo enviar ningún correo, la petición es un fallo total.
    if (!emails.internal && !emails.client) {
      throw new Error('Failed to process contact submission: CRM and email delivery were unavailable.');
    }

    // Si el CRM falló pero algún correo salió, se devuelve ok con
    // `crmPersisted: false` en lugar de un `action: 'created'` engañoso: el
    // llamador debe poder distinguir "guardado" de "solo notificado".
    return {
      ok: true,
      leadId,
      action: crmPersisted ? action : 'created',
      crmPersisted,
      emails,
    };
  }
}
