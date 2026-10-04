import { describe, expect, it, vi } from 'vitest';
import { FrontAgent } from '@agents/front-agent';
import { ITool } from '@core/ports/tool.port';
import { IToolCallingLlm } from '@core/ports/tool-calling-llm.port';

describe('FrontAgent', () => {
  it('ejecuta tools y devuelve la respuesta final (ReAct)', async () => {
    const search: ITool = {
      name: 'search_knowledge_base',
      description: 'kb',
      schema: { type: 'object' },
      execute: vi.fn(async () => ({ ok: true, chunks: [{ content: 'ofrecemos automatización' }] })),
    };

    const llm: IToolCallingLlm = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: '',
          reasoningContent: 'Need the knowledge base.',
          toolCalls: [{ id: '1', name: 'search_knowledge_base', arguments: { query: 'servicios' } }],
        })
        .mockResolvedValueOnce({
          content: 'Ofrecemos automatización.',
          reasoningContent: 'Answer from the tool result.',
          toolCalls: [],
        }),
    };

    const agent = new FrontAgent(llm, () => [search], { maxIterations: 4 });
    const result = await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'What services do you offer?' }],
    });

    expect(search.execute).toHaveBeenCalledOnce();
    expect(result.currentAgent).toBe('front_agent');
    expect(result.messages?.[0]).toMatchObject({
      role: 'assistant',
      metadata: {
        reasoningContent: 'Need the knowledge base.',
      },
    });
    expect(result.messages?.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Ofrecemos automatización.',
      name: 'front_agent',
      metadata: { reasoningContent: 'Answer from the tool result.' },
    });
  });
});

describe('FrontAgent — control de alcance', () => {
  function buildAgent() {
    const llm: IToolCallingLlm = {
      complete: vi.fn().mockResolvedValue({ content: 'respuesta', toolCalls: [] }),
    };
    const tool: ITool = {
      name: 'search_knowledge_base',
      description: 'kb',
      schema: { type: 'object' },
      execute: vi.fn(async () => ({ ok: true })),
    };
    const agent = new FrontAgent(llm, () => [tool], { maxIterations: 4 });
    return { agent, llm, tool };
  }

  it('no llama al modelo ni a las tools ante una petición ajena', async () => {
    const { agent, llm, tool } = buildAgent();

    const result = await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'como se centra un div' }],
    });

    // El rechazo es determinista: no se gasta una llamada al modelo…
    expect(llm.complete).not.toHaveBeenCalled();
    // …ni se ejecuta ninguna herramienta.
    expect(tool.execute).not.toHaveBeenCalled();
    // Y la respuesta redirige en lugar de contestar la pregunta ajena.
    const reply = result.messages?.at(-1);
    expect(reply?.role).toBe('assistant');
    expect(reply?.content).toMatch(/servicios/i);
    expect(reply?.content?.toLowerCase()).not.toContain('div');
    expect(reply?.metadata).toMatchObject({ scopeGuard: 'out_of_scope' });
  });

  it('responde en inglés si el rechazo va dirigido a un mensaje en inglés', async () => {
    const { agent } = buildAgent();

    const result = await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'how do I center a div' }],
    });

    expect(result.messages?.at(-1)?.content).toMatch(/services/i);
  });

  it('sí llama al modelo cuando la pregunta es sobre la empresa', async () => {
    const { agent, llm } = buildAgent();

    await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'Hola, ¿qué servicios ofrecen?' }],
    });

    expect(llm.complete).toHaveBeenCalled();
  });

  it('permite desactivar el guard para dejar el control sólo en el prompt', async () => {
    const llm: IToolCallingLlm = {
      complete: vi.fn().mockResolvedValue({ content: 'respuesta', toolCalls: [] }),
    };
    const agent = new FrontAgent(llm, () => [], { maxIterations: 2, enforceScope: false });

    await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'como se centra un div' }],
    });

    expect(llm.complete).toHaveBeenCalled();
  });
});

describe('FrontAgent — política de agendamiento en el contexto', () => {
  const policy = {
    timezone: 'America/New_York',
    hoursByWeekday: {
      mon: { open: '09:00', close: '18:00' },
      tue: { open: '09:00', close: '18:00' },
      wed: { open: '09:00', close: '18:00' },
      thu: { open: '09:00', close: '18:00' },
      fri: { open: '09:00', close: '18:00' },
      sat: null,
      sun: null,
    },
    holidays: ['2027-01-01'],
    appointmentTypes: {
      general: { id: 'general', name: 'Reunión General', durationMinutes: 30, maxConcurrent: 1 },
    },
    maxAppointmentsPerDay: 8,
    slotIntervalMinutes: 30,
  };

  function buildAgent(withPolicy: boolean) {
    const llm: IToolCallingLlm = {
      complete: vi.fn().mockResolvedValue({ content: 'ok', toolCalls: [] }),
    };
    const agent = new FrontAgent(llm, () => [], {
      maxIterations: 2,
      ...(withPolicy ? { policyProvider: { getPolicy: vi.fn(async () => policy) } } : {}),
    });
    return { agent, llm };
  }

  it('inyecta horario, duraciones y festivos en el system prompt', async () => {
    const { agent, llm } = buildAgent(true);

    await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: '¿Cuál es su horario?' }],
    });

    const [transcript] = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    const system = transcript.find((m) => m.role === 'system');
    expect(system?.content).toContain('POLÍTICA DE AGENDAMIENTO VIGENTE');
    expect(system?.content).toContain('America/New_York');
    expect(system?.content).toContain('lunes a viernes: 09:00-18:00');
    expect(system?.content).toContain('Reunión General');
    expect(system?.content).toContain('2027-01-01');
    // Y no debe permitir que el modelo calcule huecos por su cuenta.
    expect(system?.content).toContain('check_availability');
  });

  it('no añade nada si no hay proveedor de política', async () => {
    const { agent, llm } = buildAgent(false);

    await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: '¿Cuál es su horario?' }],
    });

    const [transcript] = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Array<{ role: string; content: string }>,
    ];
    const system = transcript.find((m) => m.role === 'system');
    expect(system?.content).not.toContain('POLÍTICA DE AGENDAMIENTO VIGENTE');
  });

  it('si la política falla, el turno continúa sin ese contexto', async () => {
    const llm: IToolCallingLlm = {
      complete: vi.fn().mockResolvedValue({ content: 'ok', toolCalls: [] }),
    };
    const agent = new FrontAgent(llm, () => [], {
      maxIterations: 2,
      policyProvider: {
        getPolicy: vi.fn(async () => {
          throw new Error('policy unavailable');
        }),
      },
    });

    const result = await agent.invoke({
      id: 'c1',
      messages: [{ role: 'user', content: 'Hola' }],
    });

    expect(llm.complete).toHaveBeenCalled();
    expect(result.messages?.at(-1)?.content).toBe('ok');
  });
});
