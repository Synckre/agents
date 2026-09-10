import { IConversation } from '@core/domain/conversation.entity';
import { IMessage } from '@core/domain/message.value-object';
import { FINISH_ROUTE } from '@core/domain/routing.constants';
import { ILLMProvider } from '@core/ports/llm-provider.port';

export interface IRoutableAgent {
  readonly name: string;
  readonly description: string;
}

/**
 * Firma del caso de uso encargado de analizar el estado actual y determinar el siguiente agente a intervenir.
 */
export interface IRouteToAgentUseCase {
  execute(conversation: IConversation): Promise<string>;
}

/**
 * Interpreta la respuesta libre del LLM y la normaliza a un agente registrado o a FINISH.
 */
export function parseAgentChoice(raw: string, allowed: readonly string[]): string {
  const text = raw.trim();
  if (!text) {
    return FINISH_ROUTE;
  }

  try {
    const parsed = JSON.parse(text) as { agent?: unknown; next?: unknown };
    const candidate = parsed.agent ?? parsed.next;
    if (typeof candidate === 'string') {
      return normalizeChoice(candidate, allowed);
    }
  } catch {
    // texto plano
  }

  return normalizeChoice(text, allowed);
}

function normalizeChoice(raw: string, allowed: readonly string[]): string {
  const compact = raw.trim().replace(/["'`]/g, '');
  const lower = compact.toLowerCase();

  const exact = allowed.find((name) => name.toLowerCase() === lower);
  if (exact) {
    return exact;
  }

  const ranked = [...allowed].sort((a, b) => b.length - a.length);
  for (const name of ranked) {
    if (lower.includes(name.toLowerCase())) {
      return name;
    }
  }

  if (/\bfinish\b/i.test(compact) || compact === '__end__') {
    return FINISH_ROUTE;
  }

  return FINISH_ROUTE;
}

/**
 * Enruta al subagente más adecuado usando el historial y el catálogo de especialistas.
 */
export class RouteToAgentUseCase implements IRouteToAgentUseCase {
  constructor(
    private readonly llm: ILLMProvider,
    private readonly agents: readonly IRoutableAgent[],
  ) {}

  async execute(conversation: IConversation): Promise<string> {
    const last = conversation.messages.at(-1);
    if (!last || last.role === 'assistant') {
      return FINISH_ROUTE;
    }

    const allowed = this.agents.map((agent) => agent.name);
    if (allowed.length === 0) {
      return FINISH_ROUTE;
    }

    const catalog = this.agents
      .map((agent) => `- ${agent.name}: ${agent.description}`)
      .join('\n');

    const history = conversation.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    const prompt: IMessage[] = [
      {
        role: 'system',
        content: [
          'Eres el supervisor de un sistema multi-agente.',
          'Elige UN solo especialista para responder el último mensaje del usuario.',
          'Responde únicamente con el nombre del agente, o FINISH si no hace falta nadie más.',
          '',
          'Agentes disponibles:',
          catalog,
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Conversación:\n${history}\n\nAgente:`,
      },
    ];

    const decision = await this.llm.generateResponse(prompt, { temperature: 0 });
    const parsed = parseAgentChoice(decision.content, allowed);

    if (parsed === FINISH_ROUTE && last.role === 'user') {
      return allowed[0] ?? FINISH_ROUTE;
    }

    return parsed;
  }
}
