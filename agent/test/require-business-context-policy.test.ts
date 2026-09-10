import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '@adapters/persistence/in-memory-store.adapter';
import { RequireBusinessContextPolicy } from '@adapters/tools/policies/require-business-context.policy';
import { IMessage } from '@core/domain/message.value-object';

describe('RequireBusinessContextPolicy', () => {
  it('permite tools que no forman parte del conjunto de tools objetivo', async () => {
    const memory = new InMemoryStore();
    // Conversación sin mensajes
    await memory.save({ id: 'c1', messages: [] });

    const policy = new RequireBusinessContextPolicy(memory, 2, ['send_email', 'save_lead']);

    const checkAvail = await policy.check({
      toolName: 'check_availability',
      conversationId: 'c1',
      args: {},
    });
    expect(checkAvail.allowed).toBe(true);

    const searchLead = await policy.check({
      toolName: 'search_lead',
      conversationId: 'c1',
      args: {},
    });
    expect(searchLead.allowed).toBe(true);
  });

  it('rechaza tools objetivo cuando la conversación no existe en el store', async () => {
    const memory = new InMemoryStore();
    const policy = new RequireBusinessContextPolicy(memory, 2, ['send_email', 'save_lead']);

    const decision = await policy.check({
      toolName: 'send_email',
      conversationId: 'non-existent',
      args: {},
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('requires at least 2 user context message(s), but only found 0');
  });

  it('rechaza tools objetivo cuando hay menos mensajes de usuario que el mínimo requerido', async () => {
    const memory = new InMemoryStore();
    // 1 mensaje de usuario y varios de asistente/sistema
    const messages: IMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'en qué puedo ayudarte?' },
      { role: 'tool', content: '{"ok":true}' },
    ];
    await memory.save({ id: 'c1', messages });

    const policy = new RequireBusinessContextPolicy(memory, 2, ['send_email', 'save_lead']);

    const emailCheck = await policy.check({
      toolName: 'send_email',
      conversationId: 'c1',
      args: {},
    });
    expect(emailCheck.allowed).toBe(false);
    expect(emailCheck.reason).toContain('requires at least 2 user context message(s), but only found 1');

    const leadCheck = await policy.check({
      toolName: 'save_lead',
      conversationId: 'c1',
      args: {},
    });
    expect(leadCheck.allowed).toBe(false);
  });

  it('permite tools objetivo cuando se cumple o supera el umbral de mensajes de usuario', async () => {
    const memory = new InMemoryStore();
    const messages: IMessage[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola, cómo te llamas?' },
      { role: 'user', content: 'me llamo Juan y me interesa el servicio' },
    ];
    await memory.save({ id: 'c1', messages });

    const policy = new RequireBusinessContextPolicy(memory, 2, ['send_email', 'save_lead']);

    const emailCheck = await policy.check({
      toolName: 'send_email',
      conversationId: 'c1',
      args: {},
    });
    expect(emailCheck.allowed).toBe(true);

    const leadCheck = await policy.check({
      toolName: 'save_lead',
      conversationId: 'c1',
      args: {},
    });
    expect(leadCheck.allowed).toBe(true);
  });

  it('soporta configuración vía objeto de opciones', async () => {
    const memory = new InMemoryStore();
    await memory.save({
      id: 'c1',
      messages: [{ role: 'user', content: 'solo un mensaje' }],
    });

    const policy = new RequireBusinessContextPolicy(memory, {
      minContextMessages: 1,
      targetTools: ['custom_tool'],
    });

    const checkCustom = await policy.check({
      toolName: 'custom_tool',
      conversationId: 'c1',
      args: {},
    });
    expect(checkCustom.allowed).toBe(true);
  });
});
