import { ILLMProvider } from '@core/ports/llm-provider.port';
import { SpecializedAgent, SpecializedAgentConfig } from './specialized-agent';

const SPECIALIST_CATALOG: readonly SpecializedAgentConfig[] = [
  {
    name: 'customer-service',
    description: 'Atención al cliente, dudas generales, quejas y seguimiento de tickets.',
    systemPrompt:
      'Eres el agente de atención al cliente de Synckre. Responde con claridad y empatía en español, en 4 frases o menos. No inventes políticas internas.',
  }
];

export function createSpecialists(llm: ILLMProvider): SpecializedAgent[] {
  return SPECIALIST_CATALOG.map((config) => new SpecializedAgent(config, llm));
}
