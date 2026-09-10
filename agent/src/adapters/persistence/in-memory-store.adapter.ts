import { IConversation } from '@core/domain/conversation.entity';
import { IMemoryStore } from '@core/ports/memory-store.port';

/**
 * Almacén de conversaciones en memoria para desarrollo y demos locales.
 */
export class InMemoryStore implements IMemoryStore {
  private readonly conversations = new Map<string, IConversation>();

  async save(conversation: IConversation): Promise<void> {
    this.conversations.set(conversation.id, {
      ...conversation,
      messages: [...conversation.messages],
    });
  }

  async getById(id: string): Promise<IConversation | null> {
    const stored = this.conversations.get(id);
    if (!stored) {
      return null;
    }

    return {
      ...stored,
      messages: [...stored.messages],
    };
  }

  async delete(id: string): Promise<void> {
    this.conversations.delete(id);
  }
}
