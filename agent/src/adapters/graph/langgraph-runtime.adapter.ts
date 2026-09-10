import { IConversation } from '@core/domain/conversation.entity';
import { IGraphRuntime } from '@core/ports/graph-runtime.port';
import { CompiledAgentGraph } from './graph-builder';

/**
 * Adaptador que aísla el runtime y dependencias de LangGraph del núcleo del sistema.
 */
export class LangGraphRuntimeAdapter implements IGraphRuntime {
  constructor(
    private readonly graph: CompiledAgentGraph,
    private readonly recursionLimit = 8,
  ) {}

  async run(conversation: IConversation): Promise<IConversation> {
    const result = await this.graph.invoke(
      {
        id: conversation.id,
        messages: [...conversation.messages],
        currentAgent: conversation.currentAgent,
        metadata: conversation.metadata,
      },
      { recursionLimit: this.recursionLimit },
    );

    return {
      id: result.id,
      messages: result.messages,
      currentAgent: result.currentAgent,
      metadata: result.metadata,
    };
  }
}
