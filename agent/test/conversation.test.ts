import { describe, expect, it } from 'vitest';
import { Conversation, isPausedForHuman, PAUSED_FOR_HUMAN } from '@core/domain/conversation.entity';

describe('Conversation', () => {
  it('pauseForHuman marca el estado y el metadata', () => {
    const paused = new Conversation({
      id: 'c1',
      messages: [{ role: 'user', content: 'ayuda' }],
    }).pauseForHuman();

    expect(paused.status).toBe(PAUSED_FOR_HUMAN);
    expect(paused.metadata?.status).toBe(PAUSED_FOR_HUMAN);
    expect(isPausedForHuman(paused)).toBe(true);
  });

  it('gestiona leads vinculados inmutablemente', () => {
    const conv = new Conversation({ id: 'c1', messages: [] });
    expect(conv.getBoundLeadId()).toBeUndefined();

    const withLead = conv.bindLead('LEAD-100');
    expect(withLead.getBoundLeadId()).toBe('LEAD-100');
    expect(conv.getBoundLeadId()).toBeUndefined(); // Inmutabilidad
  });

  it('registra y valida emails permitidos', () => {
    const conv = new Conversation({ id: 'c1', messages: [] })
      .registerEmails(['User@Example.com']);

    expect(conv.getAllowedEmails()).toContain('user@example.com');
    expect(conv.isAllowedEmail('user@example.com')).toBe(true);
    expect(conv.isAllowedEmail('hacker@evil.com')).toBe(false);
  });

  it('extrae el email literal del usuario protegiendo contra truncamientos del LLM', () => {
    const conv = new Conversation({
      id: 'c1',
      messages: [{ role: 'user', content: 'Mi correo es test.account@synckre.com' }],
    });

    const extracted = conv.extractLiteralEmail('test.acc@synckre.com');
    expect(extracted).toBe('test.account@synckre.com');
  });

  it('extrae el teléfono literal del usuario protegiendo contra omisiones y alucinaciones de tokens del LLM', () => {
    const conv = new Conversation({
      id: 'c1',
      messages: [{ role: 'user', content: 'mi teléfono es +34 612 34 56 78 para que me contacten' }],
    });

    // El LLM transcribe sin código de país o con dígitos continuos
    const extracted = conv.extractLiteralPhone('612345678');
    expect(extracted).toBe('+34 612 34 56 78');

    // Teléfono con paréntesis y guiones
    const convUs = new Conversation({
      id: 'c2',
      messages: [{ role: 'user', content: 'Call me at (555) 234-5678 anytime' }],
    });
    const extractedUs = convUs.extractLiteralPhone('5552345678');
    expect(extractedUs).toBe('(555) 234-5678');
  });

  it('extrae el nombre literal del usuario corrigiendo alucinaciones ortográficas del LLM', () => {
    const conv = new Conversation({
      id: 'c1',
      messages: [{ role: 'user', content: 'Hola, mi nombre es Ebrahim Buceta y quiero una demo' }],
    });

    // El LLM deforma el apellido duplicando una letra (alucinación por BPE)
    const extracted = conv.extractLiteralName('Ebrahim Bucetta');
    expect(extracted).toBe('Ebrahim Buceta');

    // Coincidencia insensible a mayúsculas
    const convCase = new Conversation({
      id: 'c2',
      messages: [{ role: 'user', content: 'Me llamo Carlos Mendoza' }],
    });
    const extractedCase = convCase.extractLiteralName('carlos mendoza');
    expect(extractedCase).toBe('Carlos Mendoza');
  });

  it('gestiona citas agendadas, reprogramaciones y cancelaciones', () => {
    const appt = {
      id: 'APPT-1',
      start: '2026-09-02T10:00:00Z',
      end: '2026-09-02T10:30:00Z',
      attendeeName: 'Carlos',
    };

    const conv = new Conversation({ id: 'c1', messages: [] })
      .recordAppointment(appt);

    expect(conv.getAppointmentCount()).toBe(1);
    expect(conv.getBookedAppointments()).toHaveLength(1);
    expect(conv.getBookedAppointments()[0]?.id).toBe('APPT-1');

    // Reprogramar
    const rescheduled = conv.updateAppointment('APPT-1', {
      start: '2026-09-02T11:00:00Z',
      end: '2026-09-02T11:30:00Z',
    });
    expect(rescheduled.getBookedAppointments()[0]?.start).toBe('2026-09-02T11:00:00Z');

    // Cancelar
    const cancelled = rescheduled.cancelAppointment('APPT-1');
    expect(cancelled.getBookedAppointments()).toHaveLength(0);
    expect(cancelled.getAppointmentCount()).toBe(0);
  });
});
