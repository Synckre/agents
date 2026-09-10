import { describe, expect, it } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import { BaseEvent } from '@ag-ui/client';
import { CompiledGraphAgentBridge, startCopilotKitServer } from '@adapters/http/copilotkit-endpoint';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { hashSessionToken } from '@adapters/http/security';
import { CONVERSATION_META, Conversation } from '@core/domain/conversation.entity';
import { IExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';
import { CompiledAgentGraph } from '@adapters/graph/graph-builder';

describe('CopilotKit Driver and Bridge', () => {
  describe('CompiledGraphAgentBridge (AG-UI Event Translation & HITL)', () => {
    it('emite secuencia completa de eventos para una conversación simple sin HITL', async () => {
      const memory = new InMemoryStore();
      const conversationId = 'conv-test-1';
      await memory.save(new Conversation({ id: conversationId, messages: [], status: 'active' }));

      const mockExecute: IExecuteConversationUseCase = {
        execute: async (id, userMsg) => {
          const updated = new Conversation({
            id,
            status: 'active',
            messages: [
              userMsg,
              {
                role: 'assistant',
                content: '¡Hola! ¿En qué puedo ayudarte hoy?',
                name: 'front_agent',
                timestamp: new Date(),
              },
            ],
          });
          await memory.save(updated);
          return updated;
        },
      };

      const bridge = new CompiledGraphAgentBridge(mockExecute, memory, conversationId);
      const events$ = bridge.run({
        runId: 'run-1',
        threadId: conversationId,
        messages: [{ id: 'm-1', role: 'user', content: 'Hola' }],
      });

      const events: BaseEvent[] = await firstValueFrom(events$.pipe(toArray()));
      const eventTypes = events.map((e) => e.type);

      expect(eventTypes).toContain('RUN_STARTED');
      expect(eventTypes).toContain('STATE_SNAPSHOT');
      expect(eventTypes).toContain('TEXT_MESSAGE_START');
      expect(eventTypes).toContain('TEXT_MESSAGE_CONTENT');
      expect(eventTypes).toContain('TEXT_MESSAGE_END');
      expect(eventTypes).toContain('RUN_FINISHED');

      const textChunk = events.find((e) => e.type === 'TEXT_MESSAGE_CONTENT') as unknown as { delta: string };
      expect(textChunk.delta).toBe('¡Hola! ¿En qué puedo ayudarte hoy?');

      const finished = events.find((e) => e.type === 'RUN_FINISHED') as unknown as { outcome: string };
      expect(finished.outcome).toEqual({ type: 'success' });
    });

    it('usa el conversationId de la sesión autenticada aunque CopilotKit envíe otro threadId', async () => {
      const memory = new InMemoryStore();
      const sessionId = 'session-conv';
      await memory.save(new Conversation({ id: sessionId, messages: [], status: 'active' }));

      const seenIds: string[] = [];
      const mockExecute: IExecuteConversationUseCase = {
        execute: async (id, userMsg) => {
          seenIds.push(id);
          const updated = new Conversation({
            id,
            status: 'active',
            messages: [
              userMsg,
              {
                role: 'assistant',
                content: 'ok',
                name: 'front_agent',
                timestamp: new Date(),
              },
            ],
          });
          await memory.save(updated);
          return updated;
        },
      };

      const { runWithConversationId } = await import('@adapters/http/conversation-context');
      const bridge = new CompiledGraphAgentBridge(mockExecute, memory);

      const runEvents = await runWithConversationId(sessionId, async () => {
        const events$ = bridge.run({
          runId: 'run-mismatch',
          threadId: 'copilotkit-random-thread',
          messages: [{ id: 'm-1', role: 'user', content: 'Hola' }],
        });
        return firstValueFrom(events$.pipe(toArray()));
      });

      expect(seenIds).toEqual([sessionId]);
      expect(runEvents.map((e) => e.type)).toContain('RUN_FINISHED');
    });

    it('ejecuta herramientas y propaga toolCallId sin causar el bug de validación schema #2897', async () => {
      const memory = new InMemoryStore();
      const conversationId = 'conv-tool-1';
      await memory.save(new Conversation({ id: conversationId, messages: [], status: 'active' }));

      const mockExecute: IExecuteConversationUseCase = {
        execute: async (id, userMsg) => {
          const updated = new Conversation({
            id,
            status: 'active',
            messages: [
              userMsg,
              {
                role: 'assistant',
                content: '',
                name: 'front_agent',
                timestamp: new Date(),
                metadata: {
                  toolCalls: [
                    {
                      id: 'call_search_123',
                      name: 'search_knowledge_base',
                      arguments: { query: 'servicios de Synckre' },
                    },
                  ],
                },
              },
              {
                role: 'tool',
                content: JSON.stringify({ ok: true, results: ['Info Synckre'] }),
                name: 'search_knowledge_base',
                timestamp: new Date(),
                metadata: { toolCallId: 'call_search_123' },
              },
              {
                role: 'assistant',
                content: 'Synckre ofrece servicios de automatización de procesos e IA.',
                name: 'front_agent',
                timestamp: new Date(),
              },
            ],
          });
          await memory.save(updated);
          return updated;
        },
      };

      const bridge = new CompiledGraphAgentBridge(mockExecute, memory, conversationId);
      const events$ = bridge.run({
        runId: 'run-tools',
        threadId: conversationId,
        messages: [{ id: 'm-1', role: 'user', content: '¿Qué servicios ofrecen?' }],
      });

      const events: BaseEvent[] = await firstValueFrom(events$.pipe(toArray()));

      // Verificar eventos de herramientas
      const toolStart = events.find((e) => e.type === 'TOOL_CALL_START') as unknown as {
        toolCallId: string;
        toolCallName: string;
      };
      expect(toolStart).toBeDefined();
      expect(toolStart.toolCallId).toBe('call_search_123');
      expect(toolStart.toolCallName).toBe('search_knowledge_base');

      const toolResult = events.find((e) => e.type === 'TOOL_CALL_RESULT') as unknown as {
        toolCallId: string;
        role: string;
        content: string;
      };
      expect(toolResult).toBeDefined();
      expect(toolResult.toolCallId).toBe('call_search_123');
      expect(typeof toolResult.toolCallId).toBe('string');
      expect(toolResult.toolCallId.length).toBeGreaterThan(0);
      expect(toolResult.content).toContain('Info Synckre');
    });

    it('maneja el flujo HITL (request_human) emitiendo STATE_SNAPSHOT paused_for_human y toolCallId definido', async () => {
      const memory = new InMemoryStore();
      const conversationId = 'conv-hitl-1';
      await memory.save(new Conversation({ id: conversationId, messages: [], status: 'active' }));

      const mockExecute: IExecuteConversationUseCase = {
        execute: async (id, userMsg) => {
          const updated = new Conversation({
            id,
            status: 'paused_for_human',
            messages: [
              userMsg,
              {
                role: 'assistant',
                content: '',
                name: 'front_agent',
                timestamp: new Date(),
                metadata: {
                  toolCalls: [
                    {
                      id: 'call_req_human_999',
                      name: 'request_human',
                      arguments: { reason: 'El usuario solicita hablar con una persona' },
                    },
                  ],
                },
              },
              {
                role: 'tool',
                content: JSON.stringify({
                  ok: true,
                  status: 'paused_for_human',
                  message: 'Conversation paused. Inform the user that a human will follow up, then stop.',
                }),
                name: 'request_human',
                timestamp: new Date(),
                metadata: { toolCallId: 'call_req_human_999' },
              },
              {
                role: 'assistant',
                content: 'He notificado a un asesor humano de nuestro equipo. Se pondrán en contacto contigo en breve.',
                name: 'front_agent',
                timestamp: new Date(),
              },
            ],
          });
          await memory.save(updated);
          return updated;
        },
      };

      const bridge = new CompiledGraphAgentBridge(mockExecute, memory, conversationId);
      const events$ = bridge.run({
        runId: 'run-hitl',
        threadId: conversationId,
        messages: [{ id: 'm-1', role: 'user', content: 'Quiero hablar con una persona por favor' }],
      });

      const events: BaseEvent[] = await firstValueFrom(events$.pipe(toArray()));

      // 1. Verificación contra Issue #2897: el toolCallId debe ser un string válido y nunca undefined
      const toolResult = events.find((e) => e.type === 'TOOL_CALL_RESULT') as unknown as {
        toolCallId?: string;
        content: string;
      };
      expect(toolResult).toBeDefined();
      expect(toolResult.toolCallId).toBe('call_req_human_999');
      expect(typeof toolResult.toolCallId).toBe('string');

      // 2. Verificación de emisión de estado HITL (consumible en frontend vía useCoAgentStateRender)
      const stateSnapshot = events.find((e) => e.type === 'STATE_SNAPSHOT') as unknown as {
        snapshot: { status: string; pausedForHuman: boolean };
      };
      expect(stateSnapshot).toBeDefined();
      expect(stateSnapshot.snapshot.status).toBe('paused_for_human');
      expect(stateSnapshot.snapshot.pausedForHuman).toBe(true);

      // 3. Verificación de finalización limpia
      const finished = events.find((e) => e.type === 'RUN_FINISHED') as unknown as { outcome: string };
      expect(finished.outcome).toEqual({ type: 'success' });
    });
  });

  describe('CopilotKit HTTP Server Setup & Security', () => {
    it('crea el servidor e inicializa el endpoint correctamente', () => {
      const memory = new InMemoryStore();
      const mockExecute: IExecuteConversationUseCase = {
        execute: async () => new Conversation({ id: '1', messages: [] }),
      };
      const mockGraph = {} as unknown as CompiledAgentGraph;

      const server = startCopilotKitServer({
        executeConversation: mockExecute,
        compiledGraph: mockGraph,
        memory,
        port: 0,
        corsOrigins: ['https://app.synckre.example'],
        sessionSecret: 'test-session-secret',
        rateLimitWindowMs: 60_000,
        rateLimitMax: 10,
        exposeErrorDetails: true,
      });

      expect(server).toBeDefined();
      server.close();
    });

    it('verifica hash y sesión de forma segura', async () => {
      const memory = new InMemoryStore();
      const secret = 'super-secret';
      const convId = 'conv-sec-1';
      const apiKey = `${convId}.token-xyz`;

      const conv = new Conversation({
        id: convId,
        messages: [],
        status: 'active',
        metadata: {
          [CONVERSATION_META.sessionTokenHash]: hashSessionToken(secret, apiKey),
        },
      });
      await memory.save(conv);

      const loaded = await memory.getById(convId);
      expect(loaded).toBeDefined();
      const storedHash = loaded?.metadata?.[CONVERSATION_META.sessionTokenHash];
      const computedHash = hashSessionToken(secret, apiKey);
      expect(storedHash).toBe(computedHash);
    });
  });
});
