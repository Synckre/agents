import { IMessage } from '@core/domain/message.value-object';

/**
 * Definición de herramienta que el LLM puede invocar (function calling).
 */
export interface IToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
}

export interface IToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface IToolCallingTurn {
  readonly content: string;
  readonly toolCalls: readonly IToolCall[];
  /** DeepSeek thinking mode: must be echoed on later requests that send `tools`. */
  readonly reasoningContent?: string;
}

/**
 * Puerto de un modelo con function calling nativo (ReAct).
 */
export interface IToolCallingLlm {
  complete(
    messages: readonly IMessage[],
    tools: readonly IToolDefinition[],
  ): Promise<IToolCallingTurn>;
}
