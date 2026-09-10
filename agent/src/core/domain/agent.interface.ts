import { IAgentState } from './agent-state';

/**
 * Contrato principal que define las capacidades mínimas de cualquier agente en el dominio.
 */
export interface IAgent {
  readonly name: string;
  readonly description: string;
  invoke(state: IAgentState): Promise<Partial<IAgentState>>;
}
