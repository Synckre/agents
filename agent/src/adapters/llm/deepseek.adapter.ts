import { env } from '@config/env';
import { IMessage } from '@core/domain/message.value-object';
import { ILLMProvider } from '@core/ports/llm-provider.port';
import { IToolCallingLlm } from '@core/ports/tool-calling-llm.port';
import { OpenAiCompatibleToolCallingAdapter } from './openai-compatible-tool-calling.adapter';

/**
 * Adaptador concreto para DeepSeek.
 * Implementa:
 * - ILLMProvider: completions de un solo turno para tareas acotadas (worker).
 * - IToolCallingLlm: tool calling nativo en bucle ReAct (front_agent).
 */
export class DeepSeekAdapter
  extends OpenAiCompatibleToolCallingAdapter
  implements ILLMProvider, IToolCallingLlm
{
  constructor() {
    super({
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1',
      model: env.LLM_MODEL,
      temperature: env.LLM_TEMPERATURE,
    });
  }

  async generateResponse(messages: readonly IMessage[]): Promise<IMessage> {
    const turn = await this.complete(messages, []);
    return {
      role: 'assistant',
      content: turn.content,
      timestamp: new Date(),
    };
  }
}