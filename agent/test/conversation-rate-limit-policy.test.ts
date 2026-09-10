import { describe, expect, it } from 'vitest';
import { ConversationRateLimitPolicy } from '@adapters/tools/policies/conversation-rate-limit.policy';
import { InMemoryToolCallCounter } from '@adapters/tools/policies/in-memory-tool-call-counter';

describe('ConversationRateLimitPolicy', () => {
  it('permite llamadas sin límite a tools que no están en la configuración', async () => {
    const policy = new ConversationRateLimitPolicy({
      send_email: 2,
    });

    for (let i = 0; i < 10; i += 1) {
      const decision = await policy.check({
        toolName: 'search_lead',
        conversationId: 'c1',
        args: { query: 'test' },
      });
      expect(decision.allowed).toBe(true);
    }
  });

  it('permite llamadas hasta el límite y rechaza la llamada que lo excede', async () => {
    const counter = new InMemoryToolCallCounter();
    const policy = new ConversationRateLimitPolicy(
      {
        send_email: 2,
      },
      counter,
    );

    // Primera llamada permitida
    const first = await policy.check({
      toolName: 'send_email',
      conversationId: 'c1',
      args: { to: 'a@b.com' },
    });
    expect(first.allowed).toBe(true);
    expect(counter.get('c1', 'send_email')).toBe(1);

    // Segunda llamada permitida
    const second = await policy.check({
      toolName: 'send_email',
      conversationId: 'c1',
      args: { to: 'a@b.com' },
    });
    expect(second.allowed).toBe(true);
    expect(counter.get('c1', 'send_email')).toBe(2);

    // Tercera llamada rechazada por exceder el límite (2)
    const third = await policy.check({
      toolName: 'send_email',
      conversationId: 'c1',
      args: { to: 'a@b.com' },
    });
    expect(third.allowed).toBe(false);
    expect(third.reason).toContain('Rate limit of 2 execution(s) exceeded for tool "send_email" in conversation "c1"');
    // El contador no debe haber aumentado tras el rechazo
    expect(counter.get('c1', 'send_email')).toBe(2);
  });

  it('mantiene límites aislados entre diferentes conversaciones', async () => {
    const policy = new ConversationRateLimitPolicy({
      save_lead: 1,
    });

    // En c1: 1 llamada permitida, la 2da rechazada
    const c1First = await policy.check({
      toolName: 'save_lead',
      conversationId: 'c1',
      args: {},
    });
    expect(c1First.allowed).toBe(true);

    const c1Second = await policy.check({
      toolName: 'save_lead',
      conversationId: 'c1',
      args: {},
    });
    expect(c1Second.allowed).toBe(false);

    // En c2: 1 llamada debe seguir estando permitida
    const c2First = await policy.check({
      toolName: 'save_lead',
      conversationId: 'c2',
      args: {},
    });
    expect(c2First.allowed).toBe(true);
  });

  it('mantiene límites independientes para distintas tools en la misma conversación', async () => {
    const policy = new ConversationRateLimitPolicy({
      send_email: 1,
      schedule_appointment: 2,
    });

    // Agotar send_email
    await policy.check({ toolName: 'send_email', conversationId: 'c1', args: {} });
    const emailBlocked = await policy.check({ toolName: 'send_email', conversationId: 'c1', args: {} });
    expect(emailBlocked.allowed).toBe(false);

    // schedule_appointment aún debe funcionar
    const appt1 = await policy.check({ toolName: 'schedule_appointment', conversationId: 'c1', args: {} });
    expect(appt1.allowed).toBe(true);

    const appt2 = await policy.check({ toolName: 'schedule_appointment', conversationId: 'c1', args: {} });
    expect(appt2.allowed).toBe(true);

    const appt3 = await policy.check({ toolName: 'schedule_appointment', conversationId: 'c1', args: {} });
    expect(appt3.allowed).toBe(false);
  });
});
