import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { IAgent } from '@core/domain/agent.interface';
import { IMessage } from '@core/domain/message.value-object';
import { FINISH_ROUTE } from '@core/domain/routing.constants';

const AgentGraphState = Annotation.Root({
  id: Annotation<string>({
    reducer: (left: string, right: string) => right || left,
    default: () => crypto.randomUUID(),
  }),
  messages: Annotation<IMessage[]>({
    reducer: (left: IMessage[], right: IMessage | IMessage[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  currentAgent: Annotation<string | undefined>,
  nextAgent: Annotation<string | undefined>,
  metadata: Annotation<Record<string, unknown> | undefined>,
});

type AgentStateGraph = StateGraph<
  typeof AgentGraphState.spec,
  typeof AgentGraphState.State,
  typeof AgentGraphState.Update,
  string
>;

export type CompiledAgentGraph = ReturnType<AgentStateGraph['compile']>;

/**
 * Patrón Builder para construir y compilar el StateGraph de LangGraph a partir de agentes registrados.
 */
export class GraphBuilder {
  private readonly agents: IAgent[] = [];
  private supervisor?: IAgent;

  addAgent(agent: IAgent): this {
    this.agents.push(agent);
    return this;
  }

  setSupervisor(supervisor: IAgent): this {
    this.supervisor = supervisor;
    return this;
  }

  build(): CompiledAgentGraph {
    if (this.agents.length === 0) {
      throw new Error('GraphBuilder requires at least one specialized agent before build().');
    }

    if (!this.supervisor) {
      if (this.agents.length === 1) {
        return this.buildSingleAgent(this.agents[0]);
      }
      throw new Error('GraphBuilder requires a supervisor when more than one agent is registered.');
    }

    const supervisor = this.supervisor;
    // LangGraph types N as the literal "__start__" until addNode's return type is
    // chained. Node names come from IAgent.name at runtime, so N cannot be a
    // string-literal union. We keep the real StateGraph class and only widen N.
    const graph = new StateGraph(AgentGraphState) as AgentStateGraph;
    const agentNames = new Set(this.agents.map((agent) => agent.name));

    graph.addNode(supervisor.name, async (state) => supervisor.invoke(state));

    for (const agent of this.agents) {
      graph.addNode(agent.name, async (state) => agent.invoke(state));
    }

    graph.addEdge(START, supervisor.name);

    const pathMap: Record<string, string> = { [FINISH_ROUTE]: END };
    for (const agent of this.agents) {
      pathMap[agent.name] = agent.name;
    }

    graph.addConditionalEdges(
      supervisor.name,
      (state) => {
        const next = state.nextAgent;
        if (!next || next === FINISH_ROUTE || next === END || !agentNames.has(next)) {
          return FINISH_ROUTE;
        }
        return next;
      },
      pathMap,
    );

    for (const agent of this.agents) {
      graph.addEdge(agent.name, supervisor.name);
    }

    return graph.compile();
  }

  /**
   * Grafo de un solo nodo (agente conversacional con tool-calling interno).
   */
  private buildSingleAgent(agent: IAgent): CompiledAgentGraph {
    const graph = new StateGraph(AgentGraphState) as AgentStateGraph;
    graph.addNode(agent.name, async (state) => agent.invoke(state));
    graph.addEdge(START, agent.name);
    graph.addEdge(agent.name, END);
    return graph.compile();
  }
}
