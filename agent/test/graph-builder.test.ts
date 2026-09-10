import { describe, expect, it } from 'vitest';
import { GraphBuilder } from '@adapters/graph/graph-builder';
import { BaseAgent } from '@agents/base-agent';
import { IAgentState } from '@core/domain/agent-state';
import { FINISH_ROUTE } from '@core/domain/routing.constants';

class FakeSupervisor extends BaseAgent {
  readonly name = 'SupervisorAgent';
  readonly description = 'fake';

  async invoke(state: IAgentState): Promise<Partial<IAgentState>> {
    const last = state.messages.at(-1);
    if (last?.role === 'assistant') {
      return { currentAgent: this.name, nextAgent: FINISH_ROUTE };
    }
    return { currentAgent: this.name, nextAgent: 'agenda' };
  }
}

class FakeAgenda extends BaseAgent {
  readonly name = 'agenda';
  readonly description = 'fake agenda';

  async invoke(): Promise<Partial<IAgentState>> {
    return {
      currentAgent: this.name,
      messages: [{ role: 'assistant', content: 'Cita confirmada a las 10.', name: this.name }],
    };
  }
}

describe('GraphBuilder', () => {
  it('enruta del supervisor al especialista y termina', async () => {
    const graph = new GraphBuilder()
      .setSupervisor(new FakeSupervisor())
      .addAgent(new FakeAgenda())
      .build();

    const result = await graph.invoke({
      id: 'demo',
      messages: [{ role: 'user', content: 'cita mañana a las 10' }],
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages.at(-1)).toMatchObject({
      role: 'assistant',
      name: 'agenda',
      content: 'Cita confirmada a las 10.',
    });
  });

  it('exige al menos un agente si la lista está vacía', () => {
    expect(() => new GraphBuilder().build()).toThrow(
      'GraphBuilder requires at least one specialized agent before build().',
    );
  });

  it('exige supervisor explícitamente cuando hay más de un agente registrado', () => {
    expect(() =>
      new GraphBuilder().addAgent(new FakeAgenda()).addAgent(new FakeSupervisor()).build(),
    ).toThrow('GraphBuilder requires a supervisor when more than one agent is registered.');
  });

  it('compila y ejecuta un grafo de un solo nodo sin supervisor (START -> agent -> END)', async () => {
    const graph = new GraphBuilder().addAgent(new FakeAgenda()).build();
    const result = await graph.invoke({
      id: 'solo',
      messages: [{ role: 'user', content: 'hola' }],
    });

    expect(result.messages.at(-1)).toMatchObject({
      role: 'assistant',
      name: 'agenda',
      content: 'Cita confirmada a las 10.',
    });
  });
});
