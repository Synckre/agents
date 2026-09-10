import { describe, expect, it, vi } from 'vitest';
import { ITool } from '@core/ports/tool.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';
import { ToolGuard, ToolPolicyViolation } from '@adapters/tools/tool-guard.decorator';
import { createFrontAgentTools } from '@adapters/tools/create-front-agent-tools';

function createMockTool(overrides: Partial<ITool> = {}): ITool {
  return {
    name: 'test_tool',
    description: 'A test tool for testing ToolGuard',
    schema: { type: 'object' },
    execute: vi.fn(async (args: unknown) => ({ ok: true, echo: args })),
    ...overrides,
  };
}

describe('ToolGuard Decorator', () => {
  it('delega name, description y schema a la tool interna', () => {
    const inner = createMockTool({
      name: 'my_custom_tool',
      description: 'Custom description',
      schema: { foo: 'bar' },
    });
    const guard = new ToolGuard(inner, [], 'conv-123');

    expect(guard.name).toBe('my_custom_tool');
    expect(guard.description).toBe('Custom description');
    expect(guard.schema).toEqual({ foo: 'bar' });
  });

  it('si una política rechaza, inner.execute() NUNCA se llama y lanza ToolPolicyViolation', async () => {
    const inner = createMockTool();
    const rejectPolicy: IToolPolicy = {
      name: 'StrictPolicy',
      check: vi.fn(async () => ({ allowed: false, reason: 'Blocked by policy' })),
    };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const guard = new ToolGuard(inner, [rejectPolicy], 'conv-123');

    await expect(guard.execute({ key: 'val' })).rejects.toThrow(ToolPolicyViolation);
    await expect(guard.execute({ key: 'val' })).rejects.toMatchObject({
      toolName: 'test_tool',
      reason: 'Blocked by policy',
    });

    expect(inner.execute).not.toHaveBeenCalled();
    expect(rejectPolicy.check).toHaveBeenCalledWith({
      toolName: 'test_tool',
      conversationId: 'conv-123',
      args: { key: 'val' },
    });

    expect(consoleSpy).toHaveBeenCalled();
    const logCall = consoleSpy.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('"allowed":false'),
    );
    expect(logCall).toBeDefined();
    const parsedLog = JSON.parse(logCall![0]);
    expect(parsedLog).toMatchObject({
      toolName: 'test_tool',
      conversationId: 'conv-123',
      allowed: false,
      reason: 'Blocked by policy',
    });

    consoleSpy.mockRestore();
  });

  it('si todas las políticas permiten, inner.execute() se ejecuta y su resultado se retorna intacto', async () => {
    const inner = createMockTool({
      execute: vi.fn(async (args) => ({ ok: true, data: args })),
    });

    const allowPolicy1: IToolPolicy = {
      name: 'Policy1',
      check: vi.fn(async () => ({ allowed: true })),
    };
    const allowPolicy2: IToolPolicy = {
      name: 'Policy2',
      check: vi.fn(async () => ({ allowed: true })),
    };

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const guard = new ToolGuard(inner, [allowPolicy1, allowPolicy2], 'conv-456');
    const result = await guard.execute({ x: 10, y: 20 });

    expect(result).toEqual({ ok: true, data: { x: 10, y: 20 } });
    expect(inner.execute).toHaveBeenCalledTimes(1);
    expect(inner.execute).toHaveBeenCalledWith({ x: 10, y: 20 });

    const logCall = consoleSpy.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('"allowed":true'),
    );
    expect(logCall).toBeDefined();
    const parsedLog = JSON.parse(logCall![0]);
    expect(parsedLog).toMatchObject({
      toolName: 'test_tool',
      conversationId: 'conv-456',
      allowed: true,
    });

    consoleSpy.mockRestore();
  });

  it('detiene la evaluación secuencial al primer fallo sin llamar a políticas posteriores', async () => {
    const inner = createMockTool();
    const failPolicy: IToolPolicy = {
      name: 'FirstFail',
      check: vi.fn(async () => ({ allowed: false, reason: 'Failed first' })),
    };
    const secondPolicy: IToolPolicy = {
      name: 'SecondPolicy',
      check: vi.fn(async () => ({ allowed: true })),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});

    const guard = new ToolGuard(inner, [failPolicy, secondPolicy], 'conv-789');

    await expect(guard.execute({})).rejects.toThrow(ToolPolicyViolation);
    expect(failPolicy.check).toHaveBeenCalledTimes(1);
    expect(secondPolicy.check).not.toHaveBeenCalled();
    expect(inner.execute).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('createFrontAgentTools envuelve todas las herramientas en ToolGuard y propaga logger cuando se configuran', () => {
    const dummyPolicy: IToolPolicy = {
      name: 'DummyPolicy',
      check: vi.fn(async () => ({ allowed: true })),
    };
    const mockLogger = { log: vi.fn() };

    const tools = createFrontAgentTools(
      {
        crm: {} as any,
        calendar: {} as any,
        email: {} as any,
        knowledge: {} as any,
        internalAlertEmail: 'test@synckre.com',
        policies: [dummyPolicy],
        logger: mockLogger,
      },
      {
        conversationId: 'conv-test',
        maxAppointments: 3,
        memory: {} as any,
        getState: () => ({ id: 'conv-test', messages: [] }),
      },
    );

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool).toBeInstanceOf(ToolGuard);
    }
  });

  it('notifica al IToolSecurityLogger tanto en ejecuciones permitidas como denegadas', async () => {
    const inner = createMockTool({
      name: 'guarded_tool',
      execute: vi.fn(async () => ({ ok: true })),
    });
    const rejectPolicy: IToolPolicy = {
      name: 'RejectAll',
      check: vi.fn(async () => ({ allowed: false, reason: 'Security alert' })),
    };
    const allowPolicy: IToolPolicy = {
      name: 'AllowAll',
      check: vi.fn(async () => ({ allowed: true })),
    };

    const mockLogger = {
      log: vi.fn(),
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Caso 1: denegado
    const rejectingGuard = new ToolGuard(inner, [rejectPolicy], 'c-block', mockLogger);
    await expect(rejectingGuard.execute({ sensitive: 'data' })).rejects.toThrow(ToolPolicyViolation);

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'guarded_tool',
        conversationId: 'c-block',
        allowed: false,
        reason: 'Security alert',
        args: { sensitive: 'data' },
      }),
    );

    // Caso 2: permitido
    const allowingGuard = new ToolGuard(inner, [allowPolicy], 'c-allow', mockLogger);
    await allowingGuard.execute({ safe: 'data' });

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'guarded_tool',
        conversationId: 'c-allow',
        allowed: true,
        reason: undefined,
        args: { safe: 'data' },
      }),
    );

    vi.restoreAllMocks();
  });
});
