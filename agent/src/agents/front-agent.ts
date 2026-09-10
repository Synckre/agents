import { BaseAgent } from '@agents/base-agent';
import { IAgentState } from '@core/domain/agent-state';
import { IMessage } from '@core/domain/message.value-object';
import { interpolateConfirmedValues } from '@core/domain/interpolate-confirmed-values';
import { ITool } from '@core/ports/tool.port';
import { IToolCallingLlm, IToolDefinition } from '@core/ports/tool-calling-llm.port';
import { FRONT_AGENT_SYSTEM_PROMPT } from './front-agent.prompt';

export interface IFrontAgentToolScope {
  readonly conversationId: string;
  getState(): IAgentState;
}

export type FrontAgentToolsFactory = (scope: IFrontAgentToolScope) => ITool[];

export interface FrontAgentOptions {
  readonly maxIterations?: number;
  readonly timeZone?: string;
}

function formatTurnContent(message: IMessage, timeZone: string): string {
  if (message.role !== 'user' || !message.content) {
    return message.content;
  }
  if (message.content.startsWith('[')) {
    return message.content;
  }
  const date = message.timestamp ? new Date(message.timestamp) : new Date();
  const formattedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `[${formattedDate.replace(',', '')} ${timeZone}] ${message.content}`;
}

/**
 * Agente conversacional único con bucle ReAct (tool-calling) sobre un solo nodo del grafo.
 */
export class FrontAgent extends BaseAgent {
  readonly name = 'front_agent';
  readonly description =
    'Punto único de comunicación conversacional de la empresa (chatbox). Responde en el idioma del usuario y usa tools bajo demanda.';

  constructor(
    private readonly llm: IToolCallingLlm,
    private readonly createTools: FrontAgentToolsFactory,
    private readonly options: FrontAgentOptions = {},
  ) {
    super();
  }

  async invoke(state: IAgentState): Promise<Partial<IAgentState>> {
    let current: IAgentState = state;
    const tools = this.createTools({
      conversationId: state.id,
      getState: () => current,
    });
    const definitions: IToolDefinition[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

    const produced: IMessage[] = [];
    const timeZone = this.options.timeZone ?? 'UTC';
    const transcript: IMessage[] = [
      {
        role: 'system',
        content: FRONT_AGENT_SYSTEM_PROMPT,
        name: this.name,
      },
      ...state.messages.map((msg) => ({
        ...msg,
        content: formatTurnContent(msg, timeZone),
      })),
    ];

    const maxIterations = this.options.maxIterations ?? 8;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const turn = await this.llm.complete(transcript, definitions);
      const reasoningMeta =
        turn.reasoningContent !== undefined ? { reasoningContent: turn.reasoningContent } : {};

      if (turn.toolCalls.length === 0) {
        const toolPayloads = produced
          .filter((m) => m.role === 'tool')
          .map((m) => {
            try {
              return JSON.parse(m.content);
            } catch {
              return null;
            }
          })
          .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object');

        const finalContent = interpolateConfirmedValues(turn.content, toolPayloads);

        const reply: IMessage = {
          role: 'assistant',
          content: finalContent,
          name: this.name,
          timestamp: new Date(),
          metadata: Object.keys(reasoningMeta).length > 0 ? reasoningMeta : undefined,
        };
        produced.push(reply);
        return {
          currentAgent: this.name,
          nextAgent: undefined,
          messages: produced,
          metadata: current.metadata,
        };
      }

      const assistantToolMessage: IMessage = {
        role: 'assistant',
        content: turn.content || '',
        name: this.name,
        timestamp: new Date(),
        metadata: { toolCalls: turn.toolCalls, ...reasoningMeta },
      };
      produced.push(assistantToolMessage);
      transcript.push(assistantToolMessage);

      // Ejecución paralela de herramientas para reducir latencia total
      const toolMessages = await Promise.all(
        turn.toolCalls.map(async (call) => {
          const tool = toolsByName.get(call.name);
          let payload: unknown;
          if (!tool) {
            payload = { ok: false, error: `Unknown tool: ${call.name}` };
          } else {
            try {
              payload = await tool.execute(call.arguments);
            } catch (error) {
              payload = {
                ok: false,
                error: error instanceof Error ? error.message : 'Tool execution failed',
              };
            }
          }

          return {
            role: 'tool' as const,
            content: JSON.stringify(payload),
            name: call.name,
            timestamp: new Date(),
            metadata: { toolCallId: call.id },
          };
        }),
      );

      for (const msg of toolMessages) {
        produced.push(msg);
        transcript.push(msg);
      }

      current = {
        ...current,
        messages: [...state.messages, ...produced],
        currentAgent: this.name,
      };
    }

    produced.push({
      role: 'assistant',
      content:
        'I need a moment to continue this request. Please send your last message again if I stop here.',
      name: this.name,
      timestamp: new Date(),
    });

    return {
      currentAgent: this.name,
      nextAgent: undefined,
      messages: produced,
      metadata: current.metadata,
    };
  }
}
