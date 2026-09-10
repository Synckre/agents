import { IToolCallCounter } from '@core/ports/tool-call-counter.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';
import { InMemoryToolCallCounter } from './in-memory-tool-call-counter';

/**
 * Política que limita el número de veces que se puede invocar una herramienta
 * específica dentro de la misma conversación.
 */
export class ConversationRateLimitPolicy implements IToolPolicy {
  readonly name = 'ConversationRateLimitPolicy';
  private readonly limits: Map<string, number>;
  private readonly counter: IToolCallCounter;

  constructor(
    limits: Record<string, number> | Map<string, number>,
    counter?: IToolCallCounter,
    private readonly defaultLimit?: number,
  ) {
    this.limits = limits instanceof Map ? new Map(limits) : new Map(Object.entries(limits));
    this.counter = counter ?? new InMemoryToolCallCounter();
  }

  async check(input: {
    toolName: string;
    conversationId: string;
    args: unknown;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const limit = this.limits.get(input.toolName) ?? this.defaultLimit;
    if (limit === undefined) {
      return { allowed: true };
    }

    const currentCount = await this.counter.get(input.conversationId, input.toolName);
    if (currentCount >= limit) {
      return {
        allowed: false,
        reason: `Rate limit of ${limit} execution(s) exceeded for tool "${input.toolName}" in conversation "${input.conversationId}".`,
      };
    }

    await this.counter.increment(input.conversationId, input.toolName);
    return { allowed: true };
  }
}
