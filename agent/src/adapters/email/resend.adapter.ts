import { IEmailMessage, IEmailSender } from '@core/ports/email-sender.port';
import { sanitizeResendTemplateVariables } from './resend-templates.config';

export function buildResendApiPayload(
  message: IEmailMessage,
  from: string,
): Record<string, unknown> {
  const to = Array.isArray(message.to) ? [...message.to] : [message.to];
  const payload: Record<string, unknown> = {
    from,
    to,
    subject: message.subject,
  };

  if (!message.templateId) {
    throw new Error('Emails must use a Resend template');
  }

  payload.template = {
    id: message.templateId,
    variables: sanitizeResendTemplateVariables(message.variables),
  };

  if (message.attachments && message.attachments.length > 0) {
    payload.attachments = message.attachments.map((att) => ({
      filename: att.filename,
      content: att.content,
      content_type: att.contentType,
    }));
  }

  return payload;
}

/**
 * Adaptador de correo transaccional sobre la API HTTP de Resend.
 */
export class ResendAdapter implements IEmailSender {
  constructor(
    private readonly config: {
      apiKey?: string;
      defaultFrom?: string;
    },
  ) {}

  async send(message: IEmailMessage): Promise<{ id: string }> {
    if (!this.config.apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const from = message.from ?? this.config.defaultFrom;
    if (!from) {
      throw new Error('EMAIL_FROM is not configured');
    }

    const payload = buildResendApiPayload(message, from);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { id?: string };
    return { id: data.id ?? 'unknown' };
  }
}
