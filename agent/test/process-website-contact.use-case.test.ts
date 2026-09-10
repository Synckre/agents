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
      emails: { client: true, internal: true },
    });
    expect(crm.createLead).toHaveBeenCalledOnce();
    expect(crm.appendLeadNote).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledTimes(2);
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
});
