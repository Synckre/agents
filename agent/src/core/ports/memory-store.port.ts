import { IConversation } from '@core/domain/conversation.entity';

/**
 * Puerto de persistencia para el almacenamiento y recuperación del estado y memoria de las conversaciones.
 */
export interface IMemoryStore {
  save(conversation: IConversation): Promise<void>;
  getById(id: string): Promise<IConversation | null>;
  delete(id: string): Promise<void>;
}
