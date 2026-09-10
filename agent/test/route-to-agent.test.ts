import { describe, expect, it, vi } from 'vitest';
import { IConversation } from '@core/domain/conversation.entity';
import { FINISH_ROUTE } from '@core/domain/routing.constants';
import { ILLMProvider } from '@core/ports/llm-provider.port';
import { parseAgentChoice, RouteToAgentUseCase } from '@core/use-cases/route-to-agent.use-case';

const catalog = [
  { name: 'customer-service', description: 'soporte' },
  { name: 'agenda', description: 'citas' },
];

describe('parseAgentChoice', () => {
  it('acepta el nombre exacto, JSON y coincidencia dentro del texto', () => {
    const allowed = catalog.map((agent) => agent.name);

    expect(parseAgentChoice('agenda', allowed)).toBe('agenda');
    expect(parseAgentChoice('{"agent":"customer-service"}', allowed)).toBe('customer-service');
    expect(parseAgentChoice('Ruta hacia agenda ahora', allowed)).toBe('agenda');
    expect(parseAgentChoice('FINISH', allowed)).toBe(FINISH_ROUTE);
  });
});

describe('RouteToAgentUseCase', () => {
  it('termina si el último mensaje ya es del asistente', async () => {
    const llm: ILLMProvider = {
      generateResponse: vi.fn(),
    };
    const useCase = new RouteToAgentUseCase(llm, catalog);
    const conversation: IConversation = {
      id: 'c1',
      messages: [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'listo' },
      ],
    };

    await expect(useCase.execute(conversation)).resolves.toBe(FINISH_ROUTE);
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it('pide al LLM el siguiente agente cuando el usuario acaba de hablar', async () => {
    const llm: ILLMProvider = {
      generateResponse: vi.fn(async () => ({
        role: 'assistant' as const,
        content: 'agenda',
      })),
    };
    const useCase = new RouteToAgentUseCase(llm, catalog);
    const conversation: IConversation = {
      id: 'c1',
      messages: [{ role: 'user', content: 'quiero una cita' }],
    };

    await expect(useCase.execute(conversation)).resolves.toBe('agenda');
    expect(llm.generateResponse).toHaveBeenCalledOnce();
  });
});
