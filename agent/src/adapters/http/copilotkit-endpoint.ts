import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Observable } from 'rxjs';
import { AbstractAgent, BaseEvent } from '@ag-ui/client';
import { CopilotRuntime, copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import { CONVERSATION_META, Conversation } from '@core/domain/conversation.entity';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { IExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';
import { CompiledAgentGraph } from '@adapters/graph/graph-builder';
import {
  getRequestConversationId,
  runWithConversationId,
} from './conversation-context';
import {
  applyCors,
  clientIp,
  createRateLimiter,
  createSessionToken,
  hashSessionToken,
  json,
  requestHeader,
  timingSafeEqual,
  verifySiteApiKey,
} from './security';

export interface CopilotKitEndpointDeps {
  readonly executeConversation: IExecuteConversationUseCase;
  readonly compiledGraph: CompiledAgentGraph;
  readonly memory: IMemoryStore;
  readonly port: number;
  readonly corsOrigins: string[];
  readonly sessionSecret: string;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly exposeErrorDetails: boolean;
  readonly agentName?: string;
  readonly endpointPath?: string;
  readonly publicApiKey?: string;
}

interface RunMessageInput {
  id?: string;
  role?: string;
  content?: unknown;
}

interface RunInputPayload {
  runId: string;
  threadId?: string;
  messages: RunMessageInput[];
  tools?: unknown[];
  context?: unknown[];
  state?: Record<string, unknown>;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token.length > 0 ? token : undefined;
  }
  const legacy = req.headers['x-session-token'];
  return typeof legacy === 'string' && legacy.length > 0 ? legacy : undefined;
}

function parseApiKey(token: string): string | undefined {
  const separator = token.indexOf('.');
  if (separator <= 0) {
    return undefined;
  }
  return token.slice(0, separator);
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: unknown }).text ?? '');
      }
      return '';
    })
    .join('\n')
    .trim();
}

function lastUserText(messages: RunMessageInput[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return textFromContent(messages[i]?.content);
    }
  }
  return '';
}

/**
 * Puente (Adapter) entre el protocolo AG-UI de CopilotKit y el grafo conversacional compilado.
 *
 * Hereda de AbstractAgent (@ag-ui/client) para satisfacer los métodos requeridos por el
 * runtime v2 de CopilotKit (clone, setMessages, setState, run).
 *
 * TRADUCCIÓN DE EVENTOS AG-UI:
 * - Recibe RunAgentInput con threadId y messages.
 * - Ejecuta el ciclo conversacional a través de IExecuteConversationUseCase (que a su vez invoca
 *   el grafo compilado con tool-calling, memoria en Postgres y ToolGuard).
 * - Traduce los resultados producidos al flujo de eventos estándar de AG-UI:
 *     1. RUN_STARTED
 *     2. TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_RESULT (con toolCallId explícito
 *        para prevenir el error de validación schema de CopilotKit #2897)
 *     3. STATE_SNAPSHOT (emitiendo estado 'paused_for_human' en caso de escalación HITL)
 *     4. TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END con la respuesta final
 *     5. RUN_FINISHED con outcome 'success'
 */
export class CompiledGraphAgentBridge extends AbstractAgent {
  constructor(
    private readonly executeConversation: IExecuteConversationUseCase,
    private readonly memory: IMemoryStore,
    private readonly fallbackConversationId?: string,
  ) {
    super();
  }

  override clone(): CompiledGraphAgentBridge {
    return new CompiledGraphAgentBridge(
      this.executeConversation,
      this.memory,
      this.fallbackConversationId,
    );
  }

  run(input: RunInputPayload): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      void this.executeRun(input, subscriber);
    });
  }

  private async executeRun(
    input: RunInputPayload,
    subscriber: { next: (event: BaseEvent) => void; complete: () => void; error: (err: unknown) => void },
  ): Promise<void> {
    const runId = input.runId || randomUUID();
    const threadId =
      getRequestConversationId() || input.threadId || this.fallbackConversationId;

    if (!threadId) {
      subscriber.next({
        type: 'RUN_ERROR',
        message: 'A valid threadId (conversationId) is required',
        code: 'MISSING_THREAD_ID',
      } as unknown as BaseEvent);
      subscriber.complete();
      return;
    }

    subscriber.next({
      type: 'RUN_STARTED',
      threadId,
      runId,
    } as unknown as BaseEvent);

    const userText = lastUserText(input.messages ?? []);
    if (!userText) {
      subscriber.next({
        type: 'RUN_ERROR',
        message: 'No user message text found in run input',
        code: 'MISSING_USER_MESSAGE',
      } as unknown as BaseEvent);
      subscriber.complete();
      return;
    }

    try {
      const priorConversation = await this.memory.getById(threadId);
      const priorMessageCount = priorConversation ? priorConversation.messages.length : 0;

      const updated = await this.executeConversation.execute(threadId, {
        role: 'user',
        content: userText,
        timestamp: new Date(),
      });

      // Nuevos mensajes generados durante este turno (omitimos los previos + el mensaje de usuario que añadimos)
      const allMessages = updated.messages;
      const turnMessages = allMessages.slice(priorMessageCount + 1);

      // 1. Emitir eventos de herramientas (si hubo tool calls)
      for (const msg of turnMessages) {
        if (msg.role === 'assistant' && msg.metadata?.toolCalls) {
          const toolCalls = msg.metadata.toolCalls as Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>;
          for (const call of toolCalls) {
            subscriber.next({
              type: 'TOOL_CALL_START',
              toolCallId: call.id,
              toolCallName: call.name,
              parentMessageId: runId,
            } as unknown as BaseEvent);

            subscriber.next({
              type: 'TOOL_CALL_ARGS',
              toolCallId: call.id,
              delta: JSON.stringify(call.arguments ?? {}),
            } as unknown as BaseEvent);

            subscriber.next({
              type: 'TOOL_CALL_END',
              toolCallId: call.id,
            } as unknown as BaseEvent);
          }
        } else if (msg.role === 'tool') {
          const toolCallId = String(msg.metadata?.toolCallId || 'unknown-call-id');
          subscriber.next({
            type: 'TOOL_CALL_RESULT',
            toolCallId,
            messageId: `${toolCallId}-result`,
            role: 'tool',
            content: msg.content,
          } as unknown as BaseEvent);
        }
      }

      // 2. Emitir snapshot de estado (soporta detección HITL para frontend vía useCoAgentStateRender)
      const isPausedForHuman = updated.status === 'paused_for_human';
      subscriber.next({
        type: 'STATE_SNAPSHOT',
        snapshot: {
          status: updated.status,
          pausedForHuman: isPausedForHuman,
          currentAgent: updated.currentAgent,
          metadata: updated.metadata,
        },
      } as unknown as BaseEvent);

      // 3. Emitir mensaje de texto final del asistente
      let lastAssistantText = '';
      for (let i = turnMessages.length - 1; i >= 0; i -= 1) {
        const msg = turnMessages[i];
        if (msg && msg.role === 'assistant' && !msg.metadata?.toolCalls) {
          lastAssistantText = msg.content;
          break;
        }
      }

      if (lastAssistantText) {
        const assistantMessageId = `msg-${randomUUID()}`;
        subscriber.next({
          type: 'TEXT_MESSAGE_START',
          messageId: assistantMessageId,
          role: 'assistant',
        } as unknown as BaseEvent);

        subscriber.next({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: assistantMessageId,
          delta: lastAssistantText,
        } as unknown as BaseEvent);

        subscriber.next({
          type: 'TEXT_MESSAGE_END',
          messageId: assistantMessageId,
        } as unknown as BaseEvent);
      }

      // 4. Finalización exitosa
      subscriber.next({
        type: 'RUN_FINISHED',
        threadId,
        runId,
        outcome: { type: 'success' },
      } as unknown as BaseEvent);

      subscriber.complete();
    } catch (error) {
      subscriber.next({
        type: 'RUN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown execution error',
        code: 'EXECUTION_ERROR',
      } as unknown as BaseEvent);
      subscriber.complete();
    }
  }
}

/**
 * Crea e inicializa el servidor HTTP compatible con CopilotKit.
 */
export function startCopilotKitServer(deps: CopilotKitEndpointDeps): Server {
  const agentName = deps.agentName ?? 'front_agent';
  const endpointPath = (deps.endpointPath ?? '/api/copilotkit').replace(/\/$/, '') || '/api/copilotkit';

  const limiter = createRateLimiter({
    windowMs: deps.rateLimitWindowMs,
    max: deps.rateLimitMax,
  });

  const bridgeAgent = new CompiledGraphAgentBridge(
    deps.executeConversation,
    deps.memory,
  );

  const runtime = new CopilotRuntime({
    agents: {
      [agentName]: bridgeAgent,
      default: bridgeAgent,
    },
  });

  const copilotHandler = copilotRuntimeNodeHttpEndpoint({
    endpoint: endpointPath,
    runtime,
  });

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!applyCors(req, res, deps.corsOrigins)) {
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const ip = clientIp(req);
      const path = url.pathname.replace(/\/$/, '') || '/';

      if (req.method === 'GET' && path === '/health') {
        json(res, 200, { ok: true, driver: 'copilotkit' });
        return;
      }

      // Endpoint para crear sesiones con tokens criptográficamente seguros
      if (req.method === 'POST' && (path === '/v1/session' || path === `${endpointPath}/session`)) {
        if (!limiter.allow(`session:${ip}`)) {
          json(res, 429, { error: 'Rate limit reached' });
          return;
        }
        const keyCheck = verifySiteApiKey(deps.publicApiKey, requestHeader(req, 'x-api-key'));
        if (keyCheck === 'missing_config') {
          json(res, 503, { error: 'Site API key is not configured', code: 'api_key_not_configured' });
          return;
        }
        if (keyCheck === 'invalid') {
          json(res, 401, { error: 'Authentication required', code: 'invalid_api_key' });
          return;
        }
        await createSession(res);
        return;
      }

      // Peticiones al endpoint de CopilotKit (/api/copilotkit o sub-rutas)
      if (path === endpointPath || path.startsWith(`${endpointPath}/`)) {
        if (!limiter.allow(`copilot:${ip}`)) {
          json(res, 429, { error: 'Rate limit reached' });
          return;
        }

        // Validación de token de sesión si se trata de un método de ejecución o si Authorization está presente
        const token = bearerToken(req);
        if (!token) {
          json(res, 401, {
            error: 'Authentication required. Provide Authorization: Bearer <api_key>.',
          });
          return;
        }

        const conversationId = parseApiKey(token);
        if (!conversationId) {
          json(res, 401, { error: 'Incorrect API key provided' });
          return;
        }

        const existing = await deps.memory.getById(conversationId);
        if (!existing) {
          json(res, 401, { error: 'Incorrect API key provided' });
          return;
        }

        const expected = String(existing.metadata?.[CONVERSATION_META.sessionTokenHash] ?? '');
        const provided = hashSessionToken(deps.sessionSecret, token);
        if (!expected || !timingSafeEqual(expected, provided)) {
          json(res, 401, { error: 'Incorrect API key provided' });
          return;
        }

        if (!limiter.allow(`copilot-session:${conversationId}`)) {
          json(res, 429, { error: 'Rate limit reached for session' });
          return;
        }

        runWithConversationId(conversationId, () => {
          copilotHandler(req, res);
        });
        return;
      }

      json(res, 404, { error: 'Not Found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      json(
        res,
        message === 'Payload too large' ? 413 : 500,
        deps.exposeErrorDetails ? { error: message } : { error: 'Internal server error' },
      );
    }
  }

  async function createSession(res: ServerResponse): Promise<void> {
    const conversationId = randomUUID();
    const secret = createSessionToken();
    const apiKey = `${conversationId}.${secret}`;
    const conversation = new Conversation({
      id: conversationId,
      messages: [],
      status: 'active',
      metadata: {
        [CONVERSATION_META.sessionTokenHash]: hashSessionToken(deps.sessionSecret, apiKey),
      },
    });
    await deps.memory.save(conversation);
    json(res, 201, {
      id: conversationId,
      object: 'session',
      created: Math.floor(Date.now() / 1000),
      api_key: apiKey,
    });
  }

  server.listen(deps.port);
  return server;
}
