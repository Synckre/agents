import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import {
  CONVERSATION_META,
  Conversation,
} from '@core/domain/conversation.entity';
import { IExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';
import {
  parseWebsiteContactInput,
  type WebsiteContactInput,
  type WebsiteContactResult,
} from '@core/use-cases/process-website-contact.use-case';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { CopilotRuntime, copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import { CompiledGraphAgentBridge } from './copilotkit-endpoint';
import { runWithConversationId } from './conversation-context';
import {
  applyCors,
  clientIp,
  createRateLimiter,
  createSessionToken,
  hashSessionToken,
  json,
  readJsonBody,
  requestHeader,
  timingSafeEqual,
  verifySiteApiKey,
} from './security';

export interface ChatboxServerDeps {
  readonly executeConversation: IExecuteConversationUseCase;
  readonly memory: IMemoryStore;
  readonly port: number;
  readonly host?: string;
  readonly corsOrigins: string[];
  readonly sessionSecret: string;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMax: number;
  readonly exposeErrorDetails: boolean;
  readonly model: string;
  readonly enableCopilotKit?: boolean;
  readonly checkReady?: () => Promise<void>;
  readonly processWebsiteContact?: {
    execute: (input: WebsiteContactInput) => Promise<WebsiteContactResult>;
  };
  readonly publicApiKey?: string;
}

interface ChatMessageInput {
  role?: unknown;
  content?: unknown;
}

interface ChatCompletionsBody {
  model?: unknown;
  messages?: unknown;
  stream?: unknown;
}

function openaiError(
  res: ServerResponse,
  status: number,
  message: string,
  type: string,
  code: string | null = null,
): void {
  json(res, status, {
    error: {
      message,
      type,
      param: null,
      code,
    },
  });
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

function isPersistenceUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  if (
    code === '28P01' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === '57P01' ||
    code === '57P03'
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /password authentication failed|the database system is|connection terminated|timeout expired|connect ECONNREFUSED/i.test(
    message,
  );
}

function publicApiError(
  error: unknown,
  exposeDetails: boolean,
): { status: number; message: string; code: string } {
  const raw = error instanceof Error ? error.message : 'Unexpected error';
  if (raw === 'Payload too large') {
    return { status: 413, message: raw, code: 'payload_too_large' };
  }
  if (isPersistenceUnavailable(error)) {
    return {
      status: 503,
      message: 'Conversation storage is unavailable. Try again shortly.',
      code: 'storage_unavailable',
    };
  }
  return {
    status: 500,
    message: exposeDetails ? raw : 'Internal server error',
    code: 'api_error',
  };
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

function lastUserText(messages: ChatMessageInput[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return textFromContent(messages[i]?.content);
    }
  }
  return '';
}

function parseApiKey(token: string): string | undefined {
  const separator = token.indexOf('.');
  if (separator <= 0) {
    return undefined;
  }
  return token.slice(0, separator);
}

function lastAssistantText(conversation: {
  messages: ReadonlyArray<{ role: string; content: string; metadata?: Record<string, unknown> }>;
}): string {
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const message = conversation.messages[i];
    if (message?.role === 'assistant' && !message.metadata?.toolCalls) {
      return message.content;
    }
  }
  return '';
}

function completionId(): string {
  return `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function completionPayload(params: {
  id: string;
  created: number;
  model: string;
  content: string;
  finishReason: 'stop';
}): Record<string, unknown> {
  return {
    id: params.id,
    object: 'chat.completion',
    created: params.created,
    model: params.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: params.content,
        },
        finish_reason: params.finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function writeSse(res: ServerResponse, id: string, created: number, model: string, content: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const chunk = (delta: Record<string, unknown>, finishReason: string | null): string =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
    })}\n\n`;

  res.write(chunk({ role: 'assistant', content }, null));
  res.write(chunk({}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * API OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) para el chatbox.
 */
export function startChatboxServer(deps: ChatboxServerDeps): Server {
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
      [deps.model]: bridgeAgent,
      front_agent: bridgeAgent,
      default: bridgeAgent,
    },
  });

  const copilotHandler = copilotRuntimeNodeHttpEndpoint({
    endpoint: '/api/copilotkit',
    runtime,
  });

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const ip = clientIp(req);
      const path = url.pathname.replace(/\/$/, '') || '/';

      if (req.method === 'GET' && (path === '/health' || path === '/ready')) {
        if (path === '/health') {
          json(res, 200, { ok: true, driver: 'unified' });
          return;
        }
        if (deps.checkReady) {
          try {
            await deps.checkReady();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[ready] persistence check failed:', message);
            json(res, 503, { ok: false, driver: 'unified' });
            return;
          }
        }
        json(res, 200, { ok: true, driver: 'unified' });
        return;
      }

      if (!applyCors(req, res, deps.corsOrigins)) {
        return;
      }

      if (req.method === 'GET' && path === '/v1/models') {
        json(res, 200, {
          object: 'list',
          data: [publicModel()],
        });
        return;
      }

      if (req.method === 'GET' && path.startsWith('/v1/models/')) {
        const id = decodeURIComponent(path.slice('/v1/models/'.length));
        if (id !== deps.model) {
          openaiError(res, 404, `The model '${id}' does not exist`, 'invalid_request_error', 'model_not_found');
          return;
        }
        json(res, 200, publicModel());
        return;
      }

      if (req.method === 'POST' && (path === '/v1/session' || path === '/api/copilotkit/session')) {
        if (!limiter.allow(`session:${ip}`)) {
          openaiError(res, 429, 'Rate limit reached', 'rate_limit_error', 'rate_limit_exceeded');
          return;
        }
        if (rejectUnlessSiteApiKey(req, res, 'openai')) {
          return;
        }
        await createSession(res);
        return;
      }

      if (path === '/api/copilotkit' || path.startsWith('/api/copilotkit/')) {
        if (!limiter.allow(`copilot:${ip}`)) {
          openaiError(res, 429, 'Rate limit reached', 'rate_limit_error', 'rate_limit_exceeded');
          return;
        }

        const token = bearerToken(req);
        if (!token) {
          openaiError(
            res,
            401,
            'Authentication required. Provide Authorization: Bearer <api_key>.',
            'invalid_request_error',
            'invalid_api_key',
          );
          return;
        }

        const conversationId = parseApiKey(token);
        if (!conversationId) {
          openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
          return;
        }

        const existing = await deps.memory.getById(conversationId);
        if (!existing) {
          openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
          return;
        }

        const expected = String(existing.metadata?.[CONVERSATION_META.sessionTokenHash] ?? '');
        const provided = hashSessionToken(deps.sessionSecret, token);
        if (!expected || !timingSafeEqual(expected, provided)) {
          openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
          return;
        }

        if (!limiter.allow(`copilot-session:${conversationId}`)) {
          openaiError(res, 429, 'Rate limit reached for session', 'rate_limit_error', 'rate_limit_exceeded');
          return;
        }

        runWithConversationId(conversationId, () => {
          copilotHandler(req, res);
        });
        return;
      }

      if (req.method === 'POST' && (path === '/api/v1/public/contact' || path === '/v1/public/contact')) {
        if (!limiter.allow(`contact:${ip}`)) {
          json(res, 429, { error: 'Rate limit reached', code: 'rate_limit_exceeded' });
          return;
        }

        if (rejectUnlessSiteApiKey(req, res, 'json')) {
          return;
        }

        if (!deps.processWebsiteContact) {
          json(res, 503, { error: 'Contact intake is unavailable', code: 'contact_unavailable' });
          return;
        }

        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (error) {
          if (error instanceof SyntaxError) {
            json(res, 400, { error: 'Invalid JSON', code: 'invalid_json' });
            return;
          }
          throw error;
        }

        const parsed = parseWebsiteContactInput(body);
        if ('error' in parsed) {
          json(res, 400, { error: parsed.error, code: 'invalid_request' });
          return;
        }

        try {
          const result = await deps.processWebsiteContact.execute(parsed);
          json(res, 200, result);
        } catch (error) {
          console.error('[website_contact] process error:', error);
          const mapped = publicApiError(error, deps.exposeErrorDetails);
          json(res, mapped.status, { error: mapped.message, code: mapped.code });
        }
        return;
      }

      if (req.method === 'POST' && path === '/v1/chat/completions') {
        if (!limiter.allow(`chat:${ip}`)) {
          openaiError(res, 429, 'Rate limit reached', 'rate_limit_error', 'rate_limit_exceeded');
          return;
        }
        await handleCompletions(req, res);
        return;
      }

      openaiError(res, 404, 'Invalid URL', 'invalid_request_error', 'not_found');
    } catch (error) {
      const mapped = publicApiError(error, deps.exposeErrorDetails);
      openaiError(res, mapped.status, mapped.message, 'api_error', mapped.code);
    }
  }

  function publicModel(): Record<string, unknown> {
    return {
      id: deps.model,
      object: 'model',
      created: 0,
      owned_by: 'synckre',
    };
  }

  function rejectUnlessSiteApiKey(
    req: IncomingMessage,
    res: ServerResponse,
    style: 'openai' | 'json',
  ): boolean {
    const result = verifySiteApiKey(deps.publicApiKey, requestHeader(req, 'x-api-key'));
    if (result === 'ok') return false;

    if (result === 'missing_config') {
      if (style === 'openai') {
        openaiError(
          res,
          503,
          'Site API key is not configured',
          'api_error',
          'api_key_not_configured',
        );
      } else {
        json(res, 503, { error: 'Site API key is not configured', code: 'api_key_not_configured' });
      }
      return true;
    }

    if (style === 'openai') {
      openaiError(
        res,
        401,
        'Authentication required. Provide x-api-key.',
        'invalid_request_error',
        'invalid_api_key',
      );
    } else {
      json(res, 401, { error: 'Authentication required', code: 'invalid_api_key' });
    }
    return true;
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

  async function handleCompletions(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = bearerToken(req);
    if (!token) {
      openaiError(
        res,
        401,
        'You didn\'t provide an API key. Use Authorization: Bearer <api_key>.',
        'invalid_request_error',
        'invalid_api_key',
      );
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      if (error instanceof SyntaxError) {
        openaiError(res, 400, 'Invalid JSON', 'invalid_request_error', 'invalid_json');
        return;
      }
      throw error;
    }

    const payload = body as ChatCompletionsBody;
    if (!Array.isArray(payload.messages)) {
      openaiError(res, 400, '\'messages\' is a required property', 'invalid_request_error', 'invalid_request');
      return;
    }

    const content = lastUserText(payload.messages as ChatMessageInput[]);
    if (!content) {
      openaiError(
        res,
        400,
        '\'messages\' must contain a user message with text content',
        'invalid_request_error',
        'invalid_request',
      );
      return;
    }

    const conversationId = parseApiKey(token);
    if (!conversationId) {
      openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
      return;
    }

    const existing = await deps.memory.getById(conversationId);
    if (!existing) {
      openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
      return;
    }

    const expected = String(existing.metadata?.[CONVERSATION_META.sessionTokenHash] ?? '');
    const provided = hashSessionToken(deps.sessionSecret, token);
    if (!expected || !timingSafeEqual(expected, provided)) {
      openaiError(res, 401, 'Incorrect API key provided', 'invalid_request_error', 'invalid_api_key');
      return;
    }

    if (!limiter.allow(`chat-session:${conversationId}`)) {
      openaiError(res, 429, 'Rate limit reached', 'rate_limit_error', 'rate_limit_exceeded');
      return;
    }

    const conversation = await deps.executeConversation.execute(conversationId, {
      role: 'user',
      content,
      timestamp: new Date(),
    });

    const id = completionId();
    const created = Math.floor(Date.now() / 1000);
    const assistant = lastAssistantText(conversation);
    const stream = payload.stream === true;

    if (stream) {
      writeSse(res, id, created, deps.model, assistant);
      return;
    }

    json(res, 200, completionPayload({
      id,
      created,
      model: deps.model,
      content: assistant,
      finishReason: 'stop',
    }));
  }

  server.listen(deps.port, deps.host ?? '0.0.0.0');
  return server;
}
