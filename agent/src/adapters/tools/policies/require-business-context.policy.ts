import { IMemoryStore } from '@core/ports/memory-store.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';

export interface RequireBusinessContextPolicyOptions {
  readonly minContextMessages?: number;
  readonly targetTools?: string[];
}

/**
 * Política que exige un número mínimo de mensajes previos del usuario antes de permitir
 * la ejecución de herramientas de impacto de negocio (por ejemplo, enviar correo o guardar lead).
 */
export class RequireBusinessContextPolicy implements IToolPolicy {
  readonly name = 'RequireBusinessContextPolicy';
  private readonly minContextMessages: number;
  private readonly targetTools: Set<string>;

  constructor(
    private readonly memory: IMemoryStore,
    optionsOrMinMessages: number | RequireBusinessContextPolicyOptions = 2,
    targetTools: string[] = ['send_email', 'save_lead'],
  ) {
    if (typeof optionsOrMinMessages === 'number') {
      this.minContextMessages = optionsOrMinMessages;
      this.targetTools = new Set(targetTools);
    } else {
      this.minContextMessages = optionsOrMinMessages.minContextMessages ?? 2;
      this.targetTools = new Set(optionsOrMinMessages.targetTools ?? ['send_email', 'save_lead']);
    }
  }

  async check(input: {
    toolName: string;
    conversationId: string;
    args: unknown;
  }): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.targetTools.has(input.toolName)) {
      return { allowed: true };
    }

    const conversation = await this.memory.getById(input.conversationId);
    const userMessageCount =
      conversation?.messages?.filter((m) => m.role === 'user').length ?? 0;

    if (userMessageCount < this.minContextMessages) {
      return {
        allowed: false,
        reason: `Tool "${input.toolName}" requires at least ${this.minContextMessages} user context message(s), but only found ${userMessageCount}.`,
      };
    }

    return { allowed: true };
  }
}
