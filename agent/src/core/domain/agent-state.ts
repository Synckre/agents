import { IMessage } from './message.value-object';

/**
 * Estado compartido que circula entre el supervisor y los subagentes durante un turno.
 */
export interface IAgentState {
  readonly id: string;
  readonly messages: readonly IMessage[];
  readonly currentAgent?: string;
  readonly nextAgent?: string;
  readonly metadata?: Record<string, unknown>;
}
