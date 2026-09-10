/**
 * Puerto para el seguimiento y conteo de ejecuciones de herramientas por conversación.
 */
export interface IToolCallCounter {
  get(conversationId: string, toolName: string): Promise<number> | number;
  increment(conversationId: string, toolName: string): Promise<void> | void;
  reset?(conversationId?: string): Promise<void> | void;
}
