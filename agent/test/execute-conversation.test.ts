import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { IConversation } from '@core/domain/conversation.entity';
import { IGraphRuntime } from '@core/ports/graph-runtime.port';
import { ExecuteConversationUseCase } from '@core/use-cases/execute-conversation.use-case';

describe('ExecuteConversationUseCase', () => {
  it('acumula el mensaje, ejecuta el runtime y persiste el resultado', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'primero' }],
    });

    const runtime: IGraphRuntime = {
      async run(conversation): Promise<IConversation> {
        return {
          ...conversation,
          currentAgent: 'agenda',
          messages: [
            ...conversation.messages,
            { role: 'assistant', content: 'cita reservada', name: 'agenda' },
          ],
        };
      },
    };

    const useCase = new ExecuteConversationUseCase(memory, runtime);
    const result = await useCase.execute('c1', { role: 'user', content: 'confirma' });

    expect(result.messages.map((message) => message.content)).toEqual([
      'primero',
      'confirma',
      'cita reservada',
    ]);
    expect(result.currentAgent).toBe('agenda');
    await expect(memory.getById('c1')).resolves.toEqual(result);
  });

  it('no invoca el runtime si la conversación está paused_for_human', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c-paused',
      messages: [{ role: 'user', content: 'necesito un humano' }],
      status: 'paused_for_human',
      metadata: { status: 'paused_for_human' },
    });

    const runtime: IGraphRuntime = {
      run: async () => {
        throw new Error('runtime must not be called');
      },
    };

    const useCase = new ExecuteConversationUseCase(memory, runtime);
    const result = await useCase.execute('c-paused', { role: 'user', content: 'sigue?' });

    expect(result.status).toBe('paused_for_human');
    expect(result.messages.at(-1)?.role).toBe('assistant');
    expect(result.messages.at(-1)?.content).toMatch(/espera|waiting/i);
  });
});
