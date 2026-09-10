import { IMessage } from '@core/domain/message.value-object';

/**
 * Puerto de salida para interactuar con cualquier proveedor de Modelos de Lenguaje (LLM).
 */
export interface ILLMProvider {
  generateResponse(messages: readonly IMessage[], options?: unknown): Promise<IMessage>;
}
