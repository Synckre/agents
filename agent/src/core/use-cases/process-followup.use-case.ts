import { ScheduledFollowup } from '@core/domain/scheduled-followup.entity';
import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ILLMProvider } from '@core/ports/llm-provider.port';
import {
  buildClientMessageTemplatePayload,
  buildInternalAlertTemplatePayload,
} from '@adapters/email/resend-templates.config';

export interface ProcessFollowupDeps {
  readonly llm: ILLMProvider;
  readonly emailSender: IEmailSender;
  readonly followupScheduler: IFollowupScheduler;
  /**
   * Puerto ICrm: intencional y necesario para recuperar el correo del destinatario
   * a partir del `followup.leadId` en 'send_template_email' y 'send_message',
   * y para enriquecer la alerta al equipo humano con nombre/email en 'notify_human'.
   */
  readonly crm: ICrm;
  readonly internalAlertEmail: string;
}

/**
 * Caso de uso: Procesa una acción programada de seguimiento o recordatorio.
 *
 * Reglas estrictas:
 * 1. send_template_email: plantilla fija, SIN llamar al LLM.
 * 2. send_message: llamada acotada al LLM usando únicamente followup.context y el idioma explícito.
 * 3. notify_human: alerta interna al equipo, SIN llamar al LLM.
 */
export class ProcessFollowupUseCase {
  constructor(private readonly deps: ProcessFollowupDeps) {}

  async execute(followup: ScheduledFollowup): Promise<void> {
    const lead = await this.deps.crm.getLeadById(followup.leadId);
    const recipientEmail = lead?.email;

    switch (followup.action) {
      case 'send_template_email': {
        if (!recipientEmail) {
          throw new Error(`Cannot send template email: Lead ${followup.leadId} has no email address`);
        }
        if (!followup.templateId) {
          throw new Error(`Cannot send template email: Missing templateId for followup ${followup.id}`);
        }

        const isEn = followup.language === 'en';
        await this.deps.emailSender.send({
          to: recipientEmail,
          subject: isEn ? 'Reminder: Your upcoming appointment with Synckre' : 'Recordatorio: Tu próxima cita con Synckre',
          templateId: followup.templateId,
          variables: {
            TIME_REMAINING: isEn ? 'in 24 hours' : 'en 24 horas',
            HOST: 'Synckre Team',
            CONTACT_LINK: 'https://synckre.com',
            CONTACT_TEXT: isEn ? 'Contact us' : 'Contáctanos',
            TIME_ZONE: 'EDT / New York',
          },
        });
        break;
      }

      case 'send_message': {
        if (!recipientEmail) {
          throw new Error(`Cannot send message: Lead ${followup.leadId} has no email address`);
        }

        const languageName = followup.language === 'en' ? 'English' : 'Spanish';
        const systemPrompt = `You are Synckre's assistant. Generate a polite, short followup message based STRICTLY on this context: "${followup.context}".
Language requirement: The response MUST be in ${languageName}.
Do not invent facts outside this context. Do not use conversational filler or greetings without context.`;

        const response = await this.deps.llm.generateResponse([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Generate the followup message.' },
        ]);

        const subject = followup.language === 'en' ? 'Follow-up from Synckre' : 'Seguimiento de Synckre';
        const templatePayload = buildClientMessageTemplatePayload(
          {
            title: subject,
            message: response.content,
          },
          followup.language === 'en' ? 'en' : 'es',
        );
        await this.deps.emailSender.send({
          to: recipientEmail,
          subject,
          templateId: templatePayload.templateId,
          variables: templatePayload.variables,
        });
        break;
      }

      case 'notify_human': {
        const targetEmail = this.deps.internalAlertEmail;
        if (!targetEmail) {
          throw new Error('INTERNAL_ALERT_EMAIL is not configured for notify_human action');
        }

        const alert = buildInternalAlertTemplatePayload({
          action: `Atención requerida para Lead ${followup.leadId}`,
          attendeeName: lead?.name,
          attendeeEmail: lead?.email,
          summary: followup.context,
          notes: `Lead ID: ${followup.leadId}`,
          conversationId: followup.conversationId,
        });
        await this.deps.emailSender.send({
          to: targetEmail,
          subject: `[Synckre Alert] Atención requerida para Lead ${followup.leadId}`,
          templateId: alert.templateId,
          variables: alert.variables,
        });
        break;
      }

      default: {
        const exhaustiveCheck: never = followup.action;
        throw new Error(`Unsupported followup action: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
