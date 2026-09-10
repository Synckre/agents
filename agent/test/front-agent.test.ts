import { describe, expect, it, vi } from 'vitest';
import { FrontAgent } from '@agents/front-agent';
import { ITool } from '@core/ports/tool.port';
import { IToolCallingLlm } from '@core/ports/tool-calling-llm.port';

describe('FrontAgent', () => {
  it('ejecuta tools y devuelve la respuesta final (ReAct)', async () => {
    const search: ITool = {
      name: 'search_knowledge_base',
      description: 'kb',
      schema: { type: 'object' },
      execute: vi.fn(async () => ({ ok: true, chunks: [{ content: 'ofrecemos automatización' }] })),
    };

    const llm: IToolCallingLlm = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: '',
          reasoningContent: 'Need the knowledge base.',
          toolCalls: [{ id: '1', name: 'search_knowledge_base', arguments: { query: 'servicios' } }],
        })
        .mockResolvedValueOnce({
          content: 'Ofrecemos automatización.',
          reasoningContent: 'Answer from the tool result.',
          toolCalls: [],
        }),
    };

    const agent = new FrontAgent(llm, () => [search], { maxIterations: 4 });
    const result = await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'What services do you offer?' }],
    });

    expect(search.execute).toHaveBeenCalledOnce();
    expect(result.currentAgent).toBe('front_agent');
    expect(result.messages?.[0]).toMatchObject({
      role: 'assistant',
      metadata: {
        reasoningContent: 'Need the knowledge base.',
      },
    });
    expect(result.messages?.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Ofrecemos automatización.',
      name: 'front_agent',
      metadata: { reasoningContent: 'Answer from the tool result.' },
    });
  });
});
