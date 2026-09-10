import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleToolCallingAdapter } from '@adapters/llm/openai-compatible-tool-calling.adapter';
import { IMessage } from '@core/domain/message.value-object';

describe('OpenAiCompatibleToolCallingAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guarda reasoning_content y lo reenvía en el siguiente turno con tools', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                reasoning_content: 'I should search the knowledge base.',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'search_knowledge_base', arguments: '{"query":"horarios"}' },
                  },
                ],
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Abrimos de 9 a 18.',
                reasoning_content: 'The tool returned opening hours.',
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const llm = new OpenAiCompatibleToolCallingAdapter({
      apiKey: 'test',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.2,
    });

    const first = await llm.complete([{ role: 'user', content: '¿horario?' }], [
      { name: 'search_knowledge_base', description: 'kb', schema: { type: 'object' } },
    ]);
    expect(first.reasoningContent).toBe('I should search the knowledge base.');
    expect(first.toolCalls).toHaveLength(1);

    const history: IMessage[] = [
      { role: 'user', content: '¿horario?' },
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: first.toolCalls, reasoningContent: first.reasoningContent },
      },
      {
        role: 'tool',
        content: '{"ok":true}',
        name: 'search_knowledge_base',
        metadata: { toolCallId: 'call_1' },
      },
    ];

    const second = await llm.complete(history, [
      { name: 'search_knowledge_base', description: 'kb', schema: { type: 'object' } },
    ]);
    expect(second.content).toBe('Abrimos de 9 a 18.');

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; reasoning_content?: string; tool_calls?: unknown[] }>;
    };
    const assistant = secondBody.messages.find((message) => message.role === 'assistant');
    expect(assistant?.reasoning_content).toBe('I should search the knowledge base.');
    expect(assistant?.tool_calls).toHaveLength(1);
  });
});
