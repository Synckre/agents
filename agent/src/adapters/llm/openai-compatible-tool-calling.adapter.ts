import { IMessage } from '@core/domain/message.value-object';
import {
  IToolCallingLlm,
  IToolCallingTurn,
  IToolCall,
  IToolDefinition,
} from '@core/ports/tool-calling-llm.port';
import { toOpenAiParameters } from '@adapters/tools/zod-json-schema';

interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role?: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiToolCall[];
  reasoning_content?: string | null;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: OpenAiMessage }>;
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

function mapToolCalls(calls: OpenAiToolCall[] | undefined): IToolCall[] {
  if (!calls) {
    return [];
  }
  return calls
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name as string,
      arguments: parseArguments(call.function?.arguments),
    }));
}

function reasoningFields(message: IMessage): Pick<OpenAiMessage, 'reasoning_content'> {
  const stored = message.metadata?.reasoningContent;
  if (typeof stored === 'string') {
    return { reasoning_content: stored };
  }
  const toolCalls = message.metadata?.toolCalls as IToolCall[] | undefined;
  if (message.role === 'assistant' && toolCalls && toolCalls.length > 0) {
    return { reasoning_content: '' };
  }
  return {};
}

function toApiMessage(message: IMessage): OpenAiMessage {
  const toolCalls = message.metadata?.toolCalls as IToolCall[] | undefined;
  if (message.role === 'assistant' && toolCalls && toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content || null,
      ...reasoningFields(message),
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }

  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: String(message.metadata?.toolCallId ?? message.name ?? ''),
      name: message.name,
    };
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      name: message.name,
      ...reasoningFields(message),
    };
  }

  return {
    role: message.role,
    content: message.content,
    name: message.name,
  };
}

/**
 * Cliente OpenAI-compatible (DeepSeek, OpenAI) con function calling nativo.
 */
export class OpenAiCompatibleToolCallingAdapter implements IToolCallingLlm {
  constructor(
    private readonly config: {
      apiKey: string;
      baseUrl: string;
      model: string;
      temperature: number;
    },
  ) {}

  async complete(
    messages: readonly IMessage[],
    tools: readonly IToolDefinition[],
  ): Promise<IToolCallingTurn> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: this.config.temperature,
      messages: messages.map(toApiMessage),
    };

    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toOpenAiParameters(tool.schema),
        },
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM tool-calling error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const choice = data.choices?.[0]?.message;
    const reasoningContent =
      typeof choice?.reasoning_content === 'string' ? choice.reasoning_content : undefined;
    return {
      content: choice?.content ?? '',
      toolCalls: mapToolCalls(choice?.tool_calls),
      ...(reasoningContent !== undefined ? { reasoningContent } : {}),
    };
  }
}
