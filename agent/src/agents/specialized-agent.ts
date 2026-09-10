import { IAgentState } from '@core/domain/agent-state';
import { IMessage } from '@core/domain/message.value-object';
import { ILLMProvider } from '@core/ports/llm-provider.port';
import { BaseAgent } from './base-agent';

export interface SpecializedAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
}

/**
 * Subagente de dominio que responde con un system prompt propio a través del puerto ILLMProvider.
 */
export class SpecializedAgent extends BaseAgent {
  readonly name: string;
  readonly description: string;

  constructor(
    config: SpecializedAgentConfig,
    private readonly llm: ILLMProvider,
  ) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.systemPrompt = config.systemPrompt;
  }

  private readonly systemPrompt: string;

  async invoke(state: IAgentState): Promise<Partial<IAgentState>> {
    const system: IMessage = {
      role: 'system',
      content: this.systemPrompt,
      name: this.name,
      timestamp: new Date(),
    };

    const reply = await this.llm.generateResponse([system, ...state.messages]);

    return {
      currentAgent: this.name,
      nextAgent: undefined,
      messages: [
        {
          ...reply,
          name: this.name,
        },
      ],
    };
  }
}
