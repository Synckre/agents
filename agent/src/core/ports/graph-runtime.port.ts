import { IConversation } from '@core/domain/conversation.entity';

/**
 * Puerto de salida para ejecutar el grafo de orquestación sobre una conversación.
 */
export interface IGraphRuntime {
  run(conversation: IConversation): Promise<IConversation>;
}
