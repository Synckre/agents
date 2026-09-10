import { IAgentState } from '@core/domain/agent-state';
import { FINISH_ROUTE } from '@core/domain/routing.constants';
import { IRouteToAgentUseCase } from '@core/use-cases/route-to-agent.use-case';
import { BaseAgent } from './base-agent';

/**
 * Agente Supervisor encargado de orquestar el flujo y decidir qué subagente debe responder.
 */
export class SupervisorAgent extends BaseAgent {
  readonly name: string = 'SupervisorAgent';
  readonly description: string = 'Orchestrates conversations and routes tasks to specialized subagents.';

  constructor(private readonly routeToAgent: IRouteToAgentUseCase) {
    super();
  }

  async invoke(state: IAgentState): Promise<Partial<IAgentState>> {
    const nextAgent = await this.routeToAgent.execute({
      id: state.id,
      messages: state.messages,
      currentAgent: state.currentAgent,
      metadata: state.metadata,
    });

    const routedTo =
      nextAgent === FINISH_ROUTE
        ? (state.currentAgent ?? state.metadata?.routedTo ?? nextAgent)
        : nextAgent;

    return {
      currentAgent: this.name,
      nextAgent,
      metadata: { ...state.metadata, routedTo },
    };
  }
}
