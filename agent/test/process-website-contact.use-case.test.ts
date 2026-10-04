import { describe, expect, it, vi } from 'vitest';
import { ICrm, ILead } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import {
  parseWebsiteContactInput,
  ProcessWebsiteContactUseCase,
} from '@core/use-cases/process-website-contact.use-case';

function lead(partial: Partial<ILead> = {}): ILead {
  return {
    id: 'LEAD-1',
    name: 'Ada',
    email: 'ada@company.com',
    ...partial,
  };
}

describe('parseWebsiteContactInput', () => {
  it('acepta firstName + lastName y topic', () => {
    const parsed = parseWebsiteContactInput({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@company.com',
      company: 'Analytical Engines',
      topic: 'ai',
      message: 'Need an integration layer.',
      locale: 'en',
    });
    expect(parsed).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      company: 'Analytical Engines',
      topic: 'ai',
      locale: 'en',
    });
  });

  it('rechaza email inválido', () => {
    const parsed = parseWebsiteContactInput({
      name: 'Ada',
      email: 'not-an-email',
      message: 'Hello',
    });
    expect(parsed).toEqual({ error: "Field 'email' is required and must be valid." });
  });
});

describe('ProcessWebsiteContactUseCase', () => {
  it('crea el lead, anota y envía correos de cliente e interno', async () => {
    const crm: ICrm = {
      findLead: vi.fn(async () => null),
      getLeadById: vi.fn(async () => null),
      createLead: vi.fn(async () => lead()),
      updateLead: vi.fn(async () => lead()),
      appendLeadNote: vi.fn(async () => undefined),
    };
    const email: IEmailSender = {
      send: vi.fn(async () => ({ id: 'msg_1' })),
    };

    const useCase = new ProcessWebsiteContactUseCase(crm, email, 'ops@synckre.com');
    const result = await useCase.execute({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      company: 'Analytical Engines',
      message: 'Need an integration layer.',
      locale: 'en',
    });

    expect(result).toEqual({
      ok: true,
      leadId: 'LEAD-1',
      action: 'created',
      crmPersisted: true,
      emails: { client: true, internal: true },
    });
    expect(crm.createLead).toHaveBeenCalledOnce();
    // El puerto debe recibir los datos del formulario de forma explícita, no
    // enterrados en `data`, para que cualquier CRM pueda mapearlos.
    expect(crm.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ada Lovelace',
        email: 'ada@company.com',
        companyName: 'Analytical Engines',
        source: 'Website',
      }),
    );
    expect(crm.appendLeadNote).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledTimes(2);
  });

  it('propaga el asunto del formulario al CRM', async () => {
    const crm: ICrm = {
      findLead: vi.fn(async () => null),
      getLeadById: vi.fn(async () => null),
      createLead: vi.fn(async () => lead()),
      updateLead: vi.fn(async () => lead()),
      appendLeadNote: vi.fn(async () => undefined),
    };
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg_1' })) };

    await new ProcessWebsiteContactUseCase(crm, email, '').execute({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Necesito una integración.',
      topic: 'Integraciones',
    });

    expect(crm.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ topic: 'Integraciones', source: 'Website' }),
      }),
    );
  });

  it('actualiza un lead existente y añade nota', async () => {
    const crm: ICrm = {
      findLead: vi.fn(async () => lead()),
      getLeadById: vi.fn(async () => lead()),
      createLead: vi.fn(async () => lead()),
      updateLead: vi.fn(async () => lead()),
      appendLeadNote: vi.fn(async () => undefined),
    };
    const email: IEmailSender = {
      send: vi.fn(async () => ({ id: 'msg_1' })),
    };

    const useCase = new ProcessWebsiteContactUseCase(crm, email, 'ops@synckre.com');
    const result = await useCase.execute({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Follow-up from the site.',
      locale: 'es',
    });

    expect(result.action).toBe('updated');
    expect(crm.updateLead).toHaveBeenCalledOnce();
    expect(crm.appendLeadNote).toHaveBeenCalledOnce();
    expect(crm.createLead).not.toHaveBeenCalled();
  });

  it('no falla si el CRM no está configurado o falla, y envía los correos', async () => {
    const crm: ICrm = {
      findLead: vi.fn(async () => {
        throw new Error('ERPNext is not configured');
      }),
      getLeadById: vi.fn(async () => null),
      createLead: vi.fn(async () => {
        throw new Error('ERPNext is not configured');
      }),
      updateLead: vi.fn(async () => {
        throw new Error('ERPNext is not configured');
      }),
      appendLeadNote: vi.fn(async () => undefined),
    };
    const email: IEmailSender = {
      send: vi.fn(async () => ({ id: 'msg_1' })),
    };

    const useCase = new ProcessWebsiteContactUseCase(crm, email, 'ops@synckre.com');
    const result = await useCase.execute({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Hello from website without CRM',
      locale: 'en',
    });

    expect(result.ok).toBe(true);
    expect(result.emails).toEqual({ client: true, internal: true });
    expect(email.send).toHaveBeenCalledTimes(2);
    // El llamador debe poder distinguir "guardado en el CRM" de "solo notificado".
    expect(result.crmPersisted).toBe(false);
  });

  it('reporta crmPersisted:false cuando el CRM falla aunque se envíen los correos', async () => {
    const crm: ICrm = {
      findLead: vi.fn(async () => null),
      getLeadById: vi.fn(async () => null),
      createLead: vi.fn(async () => {
        throw new Error('CRM timeout');
      }),
      updateLead: vi.fn(async () => {
        throw new Error('CRM timeout');
      }),
      appendLeadNote: vi.fn(async () => undefined),
    };
    const email: IEmailSender = { send: vi.fn(async () => ({ id: 'msg_1' })) };

    const result = await new ProcessWebsiteContactUseCase(crm, email, 'ops@synckre.com').execute({
      name: 'Ada Lovelace',
      email: 'ada@company.com',
      message: 'Hello',
    });

    expect(result.crmPersisted).toBe(false);
    // El leadId es solo un marcador: no debe confundirse con un id real del CRM.
    expect(result.leadId).toMatch(/^web-/);
  });
});
