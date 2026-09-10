import { IToolCallCounter } from '@core/ports/tool-call-counter.port';

/**
 * Implementación en memoria del contador de llamadas de herramientas por conversación.
 */
export class InMemoryToolCallCounter implements IToolCallCounter {
  private readonly counts = new Map<string, number>();

  private key(conversationId: string, toolName: string): string {
    return `${conversationId}:${toolName}`;
  }

  get(conversationId: string, toolName: string): number {
    return this.counts.get(this.key(conversationId, toolName)) ?? 0;
  }

  increment(conversationId: string, toolName: string): void {
    const key = this.key(conversationId, toolName);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  reset(conversationId?: string): void {
    if (!conversationId) {
      this.counts.clear();
      return;
    }
    const prefix = `${conversationId}:`;
    for (const key of Array.from(this.counts.keys())) {
      if (key.startsWith(prefix)) {
        this.counts.delete(key);
      }
    }
  }
}
