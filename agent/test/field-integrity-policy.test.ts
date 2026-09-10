import { describe, expect, it, vi } from 'vitest';
import { FieldIntegrityPolicy } from '@adapters/tools/policies/field-integrity.policy';
import { Conversation, IConversation } from '@core/domain/conversation.entity';
import { IMemoryStore } from '@core/ports/memory-store.port';

describe('FieldIntegrityPolicy (Tool Security Policy)', () => {
  const createMockMemory = (conversation: Partial<IConversation> | null): IMemoryStore => ({
    getById: vi.fn().mockResolvedValue(conversation ? Conversation.from(conversation as IConversation) : null),
    save: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  });

  describe('Validación de Email', () => {
    it('rechaza cuando el email en schedule_appointment no coincide con el mensaje reciente del usuario', async () => {
      const memory = createMockMemory({
        id: 'conv-1',
        messages: [
          {
            role: 'user',
            content: 'Hola, por favor agenda una cita para mañana. Mi correo es ebrahimgonzalezb@gmail.com',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      // Replicando el caso real de verbatim reproduction failure: omite la letra 'i'
      const decision = await policy.check({
        toolName: 'schedule_appointment',
        conversationId: 'conv-1',
        args: {
          start: '2026-09-10T10:00:00Z',
          end: '2026-09-10T10:30:00Z',
          attendeeName: 'Ebrahim Gonzalez',
          attendeeEmail: 'ebrahmgonzalezb@gmail.com', // Letra 'i' omitida por tokenización subword
        },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Field integrity violation: email "ebrahmgonzalezb@gmail.com"');
      expect(decision.reason).toContain('does not match user-provided email "ebrahimgonzalezb@gmail.com"');
    });

    it('rechaza también si el campo en los argumentos se llama simplemente email', async () => {
      const memory = createMockMemory({
        id: 'conv-email-alias',
        messages: [
          {
            role: 'user',
            content: 'Agenda a ebrahimgonzalezb@gmail.com',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'schedule_appointment',
        conversationId: 'conv-email-alias',
        args: {
          email: 'ebrahmgonzalezb@gmail.com',
        },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Field integrity violation: email "ebrahmgonzalezb@gmail.com"');
    });

    it('permite la llamada cuando el email coincide exactamente (case-insensitive)', async () => {
      const memory = createMockMemory({
        id: 'conv-2',
        messages: [
          {
            role: 'user',
            content: 'Mi contacto es ebrahimgonzalezb@gmail.com',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'schedule_appointment',
        conversationId: 'conv-2',
        args: {
          attendeeEmail: 'EBRAHIMGONZALEZB@GMAIL.COM', // Mayúsculas
        },
      });

      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBeUndefined();
    });

    it('permite la llamada cuando no hay email identificable en los mensajes recientes (evita falsos positivos)', async () => {
      const memory = createMockMemory({
        id: 'conv-3',
        messages: [
          {
            role: 'user',
            content: 'Quisiera saber qué servicios ofrecen para desarrollo web.',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      // El email puede venir de una tool previa, lead cargado de CRM, etc.
      const decision = await policy.check({
        toolName: 'schedule_appointment',
        conversationId: 'conv-3',
        args: {
          attendeeEmail: 'external.client@company.com',
        },
      });

      expect(decision.allowed).toBe(true);
    });
  });

  describe('Validación de Teléfono', () => {
    it('rechaza cuando el teléfono en save_lead tiene dígitos traspuestos respecto al aportado por el usuario', async () => {
      const memory = createMockMemory({
        id: 'conv-phone-1',
        messages: [
          {
            role: 'user',
            content: 'Mi teléfono es +1 555-123-4567, guárdalo por favor.',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'save_lead',
        conversationId: 'conv-phone-1',
        args: {
          name: 'Carlos',
          phone: '+1 555-132-4567', // '132' en lugar de '123' (transposición)
        },
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Field integrity violation: phone "+1 555-132-4567"');
      expect(decision.reason).toContain('does not match user-provided phone "+1 555-123-4567"');
    });

    it('permite la llamada cuando el teléfono coincide con o sin código internacional', async () => {
      const memory = createMockMemory({
        id: 'conv-phone-2',
        messages: [
          {
            role: 'user',
            content: 'Llámame al (555) 123-4567',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'save_lead',
        conversationId: 'conv-phone-2',
        args: {
          name: 'Carlos',
          phone: '15551234567', // Con prefijo 1
        },
      });

      expect(decision.allowed).toBe(true);
    });

    it('permite la llamada cuando no hay teléfono en el historial del usuario', async () => {
      const memory = createMockMemory({
        id: 'conv-phone-3',
        messages: [
          {
            role: 'user',
            content: 'Solo quiero saber los precios.',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'save_lead',
        conversationId: 'conv-phone-3',
        args: {
          phone: '5551234567',
        },
      });

      expect(decision.allowed).toBe(true);
    });
  });

  describe('Aplicación Generalizada a Cualquier Tool', () => {
    it('aplica por nombre de campo a cualquier herramienta futura no listada explícitamente', async () => {
      const memory = createMockMemory({
        id: 'conv-future',
        messages: [
          {
            role: 'user',
            content: 'Escríbeme a user@domain.com',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      // Herramienta arbitraria/futura con campo email
      const rejectedDecision = await policy.check({
        toolName: 'create_zendesk_ticket',
        conversationId: 'conv-future',
        args: {
          customerEmail: 'corrupt@domain.com',
        },
      });
      expect(rejectedDecision.allowed).toBe(false);

      const allowedDecision = await policy.check({
        toolName: 'create_zendesk_ticket',
        conversationId: 'conv-future',
        args: {
          customerEmail: 'user@domain.com',
        },
      });
      expect(allowedDecision.allowed).toBe(true);
    });

    it('ignora herramientas cuyos argumentos no contienen campos de email ni de teléfono', async () => {
      const memory = createMockMemory({
        id: 'conv-other',
        messages: [
          {
            role: 'user',
            content: 'Mi correo es user@domain.com',
            timestamp: new Date(),
          },
        ],
      });

      const policy = new FieldIntegrityPolicy(memory);

      const decision = await policy.check({
        toolName: 'check_availability',
        conversationId: 'conv-other',
        args: {
          start: '2026-09-10T10:00:00Z',
          end: '2026-09-10T18:00:00Z',
        },
      });

      expect(decision.allowed).toBe(true);
    });
  });
});
