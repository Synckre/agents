import {
  Conversation,
  IConversation,
  isPausedForHuman,
  PAUSED_FOR_HUMAN,
} from '@core/domain/conversation.entity';
import { IMessage } from '@core/domain/message.value-object';
import { IGraphRuntime } from '@core/ports/graph-runtime.port';
import { IMemoryStore } from '@core/ports/memory-store.port';

/**
 * Firma del caso de uso principal para orquestar la ejecución de una conversación a partir de un nuevo mensaje.
 */
export interface IExecuteConversationUseCase {
  execute(conversationId: string, message: IMessage): Promise<IConversation>;
}

function pausedNotice(userText: string): string {
  const looksSpanish = /[áéíóúñ¿¡]|hola|gracias|quiero|cita|ayuda|buenos|buenas/i.test(userText);
  if (looksSpanish) {
    return 'Esta conversación está en espera de un miembro del equipo. Te contactaremos pronto.';
  }
  return 'This conversation is waiting for a team member. We will contact you shortly.';
}

function mergeMetadata(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  return Object.assign({}, ...sources.filter(Boolean));
}

/**
 * Carga (o crea) la conversación, ejecuta el grafo y persiste el estado resultante.
 * Si la conversación está `paused_for_human`, no invoca al LLM ni a ninguna tool.
 */
export class ExecuteConversationUseCase implements IExecuteConversationUseCase {
  constructor(
    private readonly memory: IMemoryStore,
    private readonly runtime: IGraphRuntime,
  ) {}

  async execute(conversationId: string, message: IMessage): Promise<IConversation> {
    const existing = await this.memory.getById(conversationId);

    if (isPausedForHuman(existing)) {
      const paused: IConversation = {
        id: conversationId,
        messages: [...(existing?.messages ?? []), message, {
          role: 'assistant',
          content: pausedNotice(message.content),
          name: 'front_agent',
          timestamp: new Date(),
        }],
        currentAgent: existing?.currentAgent ?? 'front_agent',
        metadata: existing?.metadata,
        status: PAUSED_FOR_HUMAN,
      };
      await this.memory.save(paused);
      return paused;
    }

    const conversation: IConversation = {
      id: conversationId,
      messages: [...(existing?.messages ?? []), message],
      currentAgent: existing?.currentAgent,
      metadata: existing?.metadata,
      status: existing?.status ?? 'active',
    };

    const updated = await this.runtime.run(conversation);
    const latest = await this.memory.getById(conversationId);
    const paused = isPausedForHuman(updated) || isPausedForHuman(latest);
    const status = paused ? PAUSED_FOR_HUMAN : (updated.status ?? existing?.status ?? 'active');

    const toSave = new Conversation({
      ...updated,
      status,
      metadata: mergeMetadata(existing?.metadata, updated.metadata, latest?.metadata, {
        status,
      }),
    });

    await this.memory.save(toSave);
    return toSave.toJSON();
  }
}
