import { env } from '@config/env';
import { ILLMProvider } from '@core/ports/llm-provider.port';
import { IToolCallingLlm } from '@core/ports/tool-calling-llm.port';
import { DeepSeekAdapter } from './deepseek.adapter';

export type UnifiedLlmProvider = ILLMProvider & IToolCallingLlm;

/**
 * Composition helper: único punto de verdad para instanciar el proveedor de LLM en todo el sistema.
 * Lanza error explícito para proveedores no implementados (openai, anthropic).
 */
export function createLlmProvider(): UnifiedLlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'deepseek':
      return new DeepSeekAdapter();
    case 'openai':
      throw new Error('OpenAI adapter is not implemented yet. Use deepseek.');
    case 'anthropic':
      throw new Error('Anthropic adapter is not implemented yet. Use deepseek.');
    default: {
      const unexpected: never = env.LLM_PROVIDER;
      throw new Error(`Unsupported LLM provider: ${String(unexpected)}`);
    }
  }
}
