/**
 * Objeto de valor inmutable que representa un mensaje individual dentro de una conversación.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface IMessage {
  readonly role: MessageRole;
  readonly content: string;
  readonly name?: string;
  readonly timestamp?: Date;
  readonly metadata?: Record<string, unknown>;
}
