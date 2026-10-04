import { describe, expect, it, vi } from 'vitest';
import {
  buildWebsiteContactAck,
  SYNCKRE_CONTACT_EMAIL,
  SYNCKRE_SITE_URL,
} from '../src/core/domain/website-contact-ack';
import { ProcessWebsiteContactUseCase } from '../src/core/use-cases/process-website-contact.use-case';
import { ICrm, ILead } from '../src/core/ports/crm.port';
import { IEmailSender } from '../src/core/ports/email-sender.port';
import { RESEND_TEMPLATES } from '../src/adapters/email/resend-templates.config';

function lead(): ILead {
  return { id: 'LEAD-1', name: 'Ada Lovelace', email: 'ada@company.com' };
}

function fakeCrm(): ICrm {
  return {
    findLead: vi.fn(async () => null),
    getLeadById: vi.fn(async () => null),
    createLead: vi.fn(async () => lead()),
    updateLead: vi.fn(async () => lead()),
    appendLeadNote: vi.fn(async () => undefined),
  };
}

describe('buildWebsiteContactAck', () => {
  describe('en español', () => {
    const ack = buildWebsiteContactAck({ name: 'Ada Lovelace' }, 'es');

    it('muestra interés por el proyecto', () => {
      expect(ack.title).toMatch(/interesa/i);
      expect(ack.message).toMatch(/nos interesa de verdad tu proyecto/i);
    });

    it('invita a agendar una reunión', () => {
      expect(ack.message).toMatch(/reuni[oó]n|conversaci[oó]n/i);
      expect(ack.message).toMatch(/agendar/i);
      expect(ack.ctaText).toMatch(/agendar/i);
    });

    it('sugiere hacerlo con el asistente del sitio', () => {
      expect(ack.message).toContain('synckre.com');
      expect(ack.message).toMatch(/asistente/i);
      expect(ack.ctaLink).toBe(SYNCKRE_SITE_URL);
    });

    it('saluda por el nombre de pila', () => {
      expect(ack.message).toContain('Hola Ada,');
    });

    it('menciona el asunto sólo si se indicó', () => {
      expect(ack.message).not.toContain(' sobre "');
      const withTopic = buildWebsiteContactAck(
        { name: 'Ada', topic: 'Integraciones' },
        'es',
      );
      expect(withTopic.message).toContain('sobre "Integraciones"');
    });

    it('no promete que el equipo escribirá primero: invita a agendar', () => {
      // El usuario pidió invitar a agendar, no prometer contacto pasivo.
      expect(ack.message).toMatch(/sin ning[uú]n compromiso/i);
    });
  });

  describe('en inglés', () => {
    const ack = buildWebsiteContactAck({ name: 'Ada Lovelace' }, 'en');

    it('está íntegramente en inglés', () => {
      expect(ack.title).toMatch(/interested/i);
      expect(ack.message).toMatch(/we are genuinely interested/i);
      expect(ack.message).toMatch(/Hi Ada,/);
      expect(ack.ctaText).toMatch(/book/i);
      // No debe colarse texto en español.
      expect(ack.message).not.toMatch(/Hola |reuni[oó]n|agendar|gracias por/i);
    });

    it('también dirige al asistente del sitio', () => {
      expect(ack.message).toContain('synckre.com');
      expect(ack.message).toMatch(/assistant/i);
      expect(ack.ctaLink).toBe(SYNCKRE_SITE_URL);
    });
  });

  it('usa un saludo neutro si el nombre viene vacío', () => {
    const es = buildWebsiteContactAck({ name: '   ' }, 'es');
    const en = buildWebsiteContactAck({ name: '' }, 'en');
    expect(es.message).toContain('Hola de nuevo,');
    expect(en.message).toContain('Hi there,');
  });
});

describe('ProcessWebsiteContactUseCase — acuse al cliente', () => {
  function run(input: Record<string, unknown>) {
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg' })) };
    const useCase = new ProcessWebsiteContactUseCase(fakeCrm(), email, 'ops@synckre.com');
    return { email, promise: useCase.execute(input as never) };
  }

  it('envía el acuse en español con la invitación a agendar', async () => {
    const { email, promise } = run({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Necesito una integración.',
      locale: 'es',
    });
    await promise;

    const calls = (email.send as ReturnType<typeof vi.fn>).mock.calls;
    const clientEmail = calls
      .map((c) => c[0])
      .find((payload: { to: string }) => payload.to === 'ada@company.com');

    expect(clientEmail).toBeDefined();
    expect(clientEmail.templateId).toBe(RESEND_TEMPLATES.MESSAGE_ES);
    expect(clientEmail.subject).toMatch(/interesa/i);
    expect(clientEmail.variables.MESSAGE).toMatch(/agendar/i);
    expect(clientEmail.variables.CTA_LINK).toBe(SYNCKRE_SITE_URL);
    expect(clientEmail.variables.MESSAGE).toContain('synckre.com');
    expect(clientEmail.replyTo).toBe(SYNCKRE_CONTACT_EMAIL);
  });

  it('envía el acuse en inglés si el formulario viene en inglés', async () => {
    const { email, promise } = run({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'I need an integration.',
      locale: 'en',
    });
    await promise;

    const calls = (email.send as ReturnType<typeof vi.fn>).mock.calls;
    const clientEmail = calls
      .map((c) => c[0])
      .find((payload: { to: string }) => payload.to === 'ada@company.com');

    expect(clientEmail.templateId).toBe(RESEND_TEMPLATES.MESSAGE_EN);
    expect(clientEmail.variables.MESSAGE).toMatch(/interested/i);
    expect(clientEmail.variables.MESSAGE).toMatch(/book/i);
    expect(clientEmail.variables.CTA_LINK).toBe(SYNCKRE_SITE_URL);
  });

  it('por defecto usa español si el formulario no indica idioma', async () => {
    const { email, promise } = run({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Necesito una integración.',
    });
    await promise;

    const calls = (email.send as ReturnType<typeof vi.fn>).mock.calls;
    const clientEmail = calls
      .map((c) => c[0])
      .find((payload: { to: string }) => payload.to === 'ada@company.com');

    expect(clientEmail.templateId).toBe(RESEND_TEMPLATES.MESSAGE_ES);
  });
});
