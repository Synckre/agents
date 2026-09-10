import { IAgent } from '@core/domain/agent.interface';
import { IAgentState } from '@core/domain/agent-state';

/**
 * Clase base abstracta para la creación de cualquier agente especializado en el sistema.
 */
export abstract class BaseAgent implements IAgent {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract invoke(state: IAgentState): Promise<Partial<IAgentState>>;
}
