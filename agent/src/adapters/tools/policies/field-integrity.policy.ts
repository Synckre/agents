import { EMAIL_REGEX, PHONE_REGEX } from '@core/domain/conversation.entity';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';

/**
 * Política de seguridad que previene la corrupción o transposición de caracteres en datos
 * de contacto (email / teléfono) generados por el LLM (verbatim reproduction failure).
 *
 * Aplica de forma transversal a CUALQUIER herramienta que reciba campos de email o teléfono
 * en sus argumentos, contrastándolos determinísticamente mediante regex contra lo aportado
 * por el usuario en mensajes recientes de la conversación.
 */
export class FieldIntegrityPolicy implements IToolPolicy {
  readonly name = 'FieldIntegrityPolicy';

  constructor(private readonly memory: IMemoryStore) {}

  async check(input: {
    toolName: string;
    conversationId: string;
    args: unknown;
  }): Promise<{ allowed: boolean; reason?: string }> {
    if (!input.args || typeof input.args !== 'object') {
      return { allowed: true };
    }

    const argsRecord = input.args as Record<string, unknown>;

    const emailField = this.findEmailValue(argsRecord, input.toolName);
    const phoneField = this.findPhoneValue(argsRecord);

    // Si la llamada no contiene ningún dato de contacto relevante, no aplica
    if (!emailField && !phoneField) {
      return { allowed: true };
    }

    const conversation = await this.memory.getById(input.conversationId);
    if (!conversation?.messages || conversation.messages.length === 0) {
      return { allowed: true };
    }

    const userMessages = conversation.messages
      .filter((m) => m.role === 'user')
      .reverse();

    // 1. Verificación de integridad para campo de Email
    if (emailField) {
      const userEmails = this.extractEmailsFromUserMessages(userMessages);

      // Si el usuario proporcionó uno o más emails en mensajes recientes, exigimos coincidencia estricta
      if (userEmails.length > 0) {
        const normalizedArg = emailField.trim().toLowerCase();
        const matchesAnyUserEmail = userEmails.some(
          (uEmail) => uEmail.trim().toLowerCase() === normalizedArg,
        );

        if (!matchesAnyUserEmail) {
          return {
            allowed: false,
            reason: `Field integrity violation: email "${emailField}" in tool "${input.toolName}" does not match user-provided email "${userEmails[0]}" in conversation.`,
          };
        }
      }
      // Si no hay emails en el texto del usuario (ej. proviene de CRM o tool previa), permitimos para evitar falso positivo
    }

    // 2. Verificación de integridad para campo de Teléfono
    if (phoneField) {
      const userPhones = this.extractPhonesFromUserMessages(userMessages);

      if (userPhones.length > 0) {
        const argDigits = phoneField.replace(/\D/g, '');
        const matchesAnyUserPhone = userPhones.some((uPhone) => {
          const uDigits = uPhone.replace(/\D/g, '');
          return (
            uDigits === argDigits ||
            uDigits.endsWith(argDigits) ||
            argDigits.endsWith(uDigits)
          );
        });

        if (!matchesAnyUserPhone) {
          return {
            allowed: false,
            reason: `Field integrity violation: phone "${phoneField}" in tool "${input.toolName}" does not match user-provided phone "${userPhones[0]}" in conversation.`,
          };
        }
      }
    }

    return { allowed: true };
  }

  private findEmailValue(args: Record<string, unknown>, toolName: string): string | undefined {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'email' ||
        lowerKey.endsWith('email') ||
        (toolName === 'send_email' && lowerKey === 'to')
      ) {
        return value.trim();
      }
    }
    return undefined;
  }

  private findPhoneValue(args: Record<string, unknown>): string | undefined {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'phone' ||
        lowerKey.endsWith('phone') ||
        lowerKey === 'phonenumber' ||
        lowerKey === 'phone_number' ||
        lowerKey === 'tel'
      ) {
        return value.trim();
      }
    }
    return undefined;
  }

  private extractEmailsFromUserMessages(
    userMessages: Array<{ content: string }>,
  ): string[] {
    const emails: string[] = [];
    for (const msg of userMessages) {
      const matches = msg.content.match(EMAIL_REGEX);
      if (matches) {
        for (const match of matches) {
          const trimmed = match.trim();
          if (!emails.some((e) => e.toLowerCase() === trimmed.toLowerCase())) {
            emails.push(trimmed);
          }
        }
      }
    }
    return emails;
  }

  private extractPhonesFromUserMessages(
    userMessages: Array<{ content: string }>,
  ): string[] {
    const phones: string[] = [];
    for (const msg of userMessages) {
      const matches = msg.content.match(PHONE_REGEX);
      if (matches) {
        for (const match of matches) {
          const digits = match.replace(/\D/g, '');
          if (digits.length >= 7 && digits.length <= 15) {
            if (!phones.some((p) => p.replace(/\D/g, '') === digits)) {
              phones.push(match.trim());
            }
          }
        }
      }
    }
    return phones;
  }
}
