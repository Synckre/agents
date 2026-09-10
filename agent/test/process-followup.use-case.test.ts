import { describe, expect, it, vi } from 'vitest';
import { ProcessFollowupUseCase } from '@core/use-cases/process-followup.use-case';
import { ScheduledFollowup } from '@core/domain/scheduled-followup.entity';
import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ILLMProvider } from '@core/ports/llm-provider.port';

describe('ProcessFollowupUseCase', () => {
  const baseFollowup: ScheduledFollowup = {
    id: 'f-1',
    leadId: 'LEAD-99',
    conversationId: 'CONV-1',
    dueAt: new Date('2026-09-04T10:00:00Z'),
    type: 'reminder',
    action: 'send_template_email',
    context: 'Recordatorio 24h antes',
    templateId: 'tmpl-resend-123',
    language: 'es',
    status: 'pending',
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('send_template_email: envía correo vía plantilla sin invocar al LLM', async () => {
    const mockCrm: ICrm = {
      findLead: vi.fn(),
      getLeadById: vi.fn().mockResolvedValue({ id: 'LEAD-99', email: 'cliente@test.com' }),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      appendLeadNote: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-ok' }),
    };

    const mockLlm: ILLMProvider = {
      generateResponse: vi.fn(),
    };

    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const useCase = new ProcessFollowupUseCase({
      crm: mockCrm,
      emailSender: mockEmail,
      llm: mockLlm,
      followupScheduler: mockScheduler,
      internalAlertEmail: 'team@synckre.com',
    });

    await useCase.execute(baseFollowup);

    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'cliente@test.com',
        templateId: 'tmpl-resend-123',
      }),
    );
    expect(mockLlm.generateResponse).not.toHaveBeenCalled();
  });

  it('Ajuste 5: send_message genera mensaje con LLM usando language explícito', async () => {
    const mockCrm: ICrm = {
      findLead: vi.fn(),
      getLeadById: vi.fn().mockResolvedValue({ id: 'LEAD-99', email: 'client@example.com' }),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      appendLeadNote: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-2' }),
    };

    const mockLlm: ILLMProvider = {
      generateResponse: vi.fn().mockResolvedValue({
        role: 'assistant',
        content: 'Hi! Just following up on our discussion regarding the API integration.',
      }),
    };

    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const useCase = new ProcessFollowupUseCase({
      crm: mockCrm,
      emailSender: mockEmail,
      llm: mockLlm,
      followupScheduler: mockScheduler,
      internalAlertEmail: 'team@synckre.com',
    });

    const followupEn: ScheduledFollowup = {
      ...baseFollowup,
      action: 'send_message',
      context: 'Follow up on API integration pricing discussion',
      language: 'en',
    };

    await useCase.execute(followupEn);

    // Verifica que el LLM fue llamado con instrucción explícita de idioma inglés
    expect(mockLlm.generateResponse).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('The response MUST be in English'),
        }),
      ]),
    );

    // Verifica que se envió el correo con el texto generado
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        templateId: expect.any(String),
        variables: expect.objectContaining({
          MESSAGE: 'Hi! Just following up on our discussion regarding the API integration.',
        }),
      }),
    );
  });

  it('notify_human: envía notificación interna al equipo sin invocar al LLM', async () => {
    const mockCrm: ICrm = {
      findLead: vi.fn(),
      getLeadById: vi.fn().mockResolvedValue({ id: 'LEAD-99', name: 'Juan', email: 'juan@test.com' }),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      appendLeadNote: vi.fn(),
    };

    const mockEmail: IEmailSender = {
      send: vi.fn().mockResolvedValue({ id: 'msg-alert' }),
    };

    const mockLlm: ILLMProvider = {
      generateResponse: vi.fn(),
    };

    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn(),
      claimForProcessing: vi.fn(),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const useCase = new ProcessFollowupUseCase({
      crm: mockCrm,
      emailSender: mockEmail,
      llm: mockLlm,
      followupScheduler: mockScheduler,
      internalAlertEmail: 'alerts@synckre.com',
    });

    const followupAlert: ScheduledFollowup = {
      ...baseFollowup,
      action: 'notify_human',
      context: 'El cliente quiere hablar con un ejecutivo de cuentas inmediatamente',
    };

    await useCase.execute(followupAlert);

    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alerts@synckre.com',
        subject: expect.stringContaining('[Synckre Alert]'),
        templateId: expect.any(String),
        variables: expect.objectContaining({
          SUMMARY: expect.stringContaining('El cliente quiere hablar con un ejecutivo'),
        }),
      }),
    );
    expect(mockLlm.generateResponse).not.toHaveBeenCalled();
  });
});
