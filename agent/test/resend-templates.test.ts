import { describe, expect, it } from 'vitest';
import {
  buildConfirmationTemplatePayload,
  buildReminderTemplatePayload,
  buildRescheduleTemplatePayload,
  buildCancelTemplatePayload,
  buildInternalAlertTemplatePayload,
  RESEND_TEMPLATES,
  TEMPLATE_VARIABLES,
} from '@adapters/email/resend-templates.config';

describe('resend-templates.config', () => {
  const sampleData = {
    attendeeName: 'Ebrahim Buceta',
    attendeeEmail: 'ebrahim@synckre.com',
    start: new Date('2026-09-03T18:30:00.000Z'),
    end: new Date('2026-09-03T19:30:00.000Z'),
    timeZone: 'America/New_York',
    meetLink: 'https://meet.google.com/test-meet',
  };

  it('exporta TEMPLATE_VARIABLES con todos los identificadores en inglés de la tabla oficial', () => {
    expect(TEMPLATE_VARIABLES.DATE).toBe('DATE');
    expect(TEMPLATE_VARIABLES.TIME).toBe('TIME');
    expect(TEMPLATE_VARIABLES.TIME_ZONE).toBe('TIME_ZONE');
    expect(TEMPLATE_VARIABLES.HOST).toBe('HOST');
    expect(TEMPLATE_VARIABLES.REASON).toBe('REASON');
    expect(TEMPLATE_VARIABLES.RESCHEDULE_LINK).toBe('RESCHEDULE_LINK');
    expect(TEMPLATE_VARIABLES.CONTACT_LINK).toBe('CONTACT_LINK');
    expect(TEMPLATE_VARIABLES.CONTACT_TEXT).toBe('CONTACT_TEXT');
    expect(TEMPLATE_VARIABLES.PREVIOUS_DATE).toBe('PREVIOUS_DATE');
    expect(TEMPLATE_VARIABLES.PREVIOUS_TIME).toBe('PREVIOUS_TIME');
    expect(TEMPLATE_VARIABLES.TIME_REMAINING).toBe('TIME_REMAINING');
    expect(TEMPLATE_VARIABLES.CLIENT_NAME).toBe('CLIENT_NAME');
    expect(TEMPLATE_VARIABLES.CLIENT_EMAIL).toBe('CLIENT_EMAIL');
    expect(TEMPLATE_VARIABLES.NOTES).toBe('NOTES');
    expect(TEMPLATE_VARIABLES.NEXT_STEP).toBe('NEXT_STEP');
    expect(TEMPLATE_VARIABLES.SUMMARY).toBe('SUMMARY');
    expect(TEMPLATE_VARIABLES.CTA_LINK).toBe('CTA_LINK');
    expect(TEMPLATE_VARIABLES.CTA_TEXT).toBe('CTA_TEXT');
    expect(TEMPLATE_VARIABLES.MEET_LINK).toBe('MEET_LINK');
    expect(TEMPLATE_VARIABLES.PREVIOUS_SUMMARY).toBe('PREVIOUS_SUMMARY');
    expect(TEMPLATE_VARIABLES.CONVERSATION_LINK).toBe('CONVERSATION_LINK');
  });

  it('construye payload de confirmación con variables en inglés, HOST Synckre Team y TIME_ZONE EDT / New York', () => {
    const payload = buildConfirmationTemplatePayload(sampleData, 'es');
    expect(payload.templateId).toBe(RESEND_TEMPLATES.CONFIRMATION_ES);
    expect(payload.variables.CLIENT_GIVEN_NAME).toBe('Ebrahim');
    expect(payload.variables.MEET_LINK).toBe('https://meet.google.com/test-meet');
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
    expect(payload.variables.CONTACT_LINK).toBe('https://synckre.com');
    expect(payload.variables.CTA_LINK).toBe('https://synckre.com');
    expect(payload.variables.CLIENT_EMAIL).toBe('ebrahim@synckre.com');
    expect(payload.variables.FECHA).toBeUndefined();
    expect(payload.variables.HORA).toBeUndefined();
    expect(payload.variables.ANFITRION).toBeUndefined();
  });

  it('construye payload de confirmación en inglés con HOST Synckre Team', () => {
    const payload = buildConfirmationTemplatePayload(sampleData, 'en');
    expect(payload.templateId).toBe(RESEND_TEMPLATES.CONFIRMATION_EN);
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
  });

  it('construye payload de recordatorio con HOST Synckre Team y TIME_ZONE EDT / New York', () => {
    const payload = buildReminderTemplatePayload(
      { ...sampleData, remainingTimeText: 'en 2 horas' },
      'es',
    );
    expect(payload.templateId).toBe(RESEND_TEMPLATES.REMINDER_ES);
    expect(payload.variables.TIME_REMAINING).toBe('en 2 horas');
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
    expect(payload.variables.MEET_LINK).toBe('https://meet.google.com/test-meet');
    expect(payload.variables.FECHA).toBeUndefined();
  });

  it('construye payload de recordatorio en inglés con HOST Synckre Team', () => {
    const payload = buildReminderTemplatePayload(
      { ...sampleData, remainingTimeText: 'in 2 hours' },
      'en',
    );
    expect(payload.templateId).toBe(RESEND_TEMPLATES.REMINDER_EN);
    expect(payload.variables.TIME_REMAINING).toBe('in 2 hours');
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
  });

  it('construye payload de reagendamiento con PREVIOUS_DATE, TIME_ZONE EDT / New York y HOST Synckre Team', () => {
    const payload = buildRescheduleTemplatePayload(
      {
        ...sampleData,
        previousStart: new Date('2026-09-02T15:00:00.000Z'),
        previousEnd: new Date('2026-09-02T16:00:00.000Z'),
      },
      'es',
    );
    expect(payload.templateId).toBe(RESEND_TEMPLATES.RESCHEDULE_ES);
    expect(payload.variables.PREVIOUS_DATE).toBeDefined();
    expect(payload.variables.PREVIOUS_TIME).toBeDefined();
    expect(payload.variables.DATE).toBeDefined();
    expect(payload.variables.TIME).toBeDefined();
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
    expect(payload.variables.MEET_LINK).toBe('https://meet.google.com/test-meet');
    expect(payload.variables.FECHA_ANTERIOR).toBeUndefined();
  });

  it('construye payload de cancelación con REASON, RESCHEDULE_LINK, TIME_ZONE y HOST Synckre Team', () => {
    const payload = buildCancelTemplatePayload(
      {
        ...sampleData,
        reason: 'Imprevisto laboral',
      },
      'es',
    );
    expect(payload.templateId).toBe(RESEND_TEMPLATES.CANCEL_ES);
    expect(payload.variables.REASON).toBe('Imprevisto laboral');
    expect(payload.variables.RESCHEDULE_LINK).toBe('https://synckre.com');
    expect(payload.variables.DATE).toBeDefined();
    expect(payload.variables.TIME).toBeDefined();
    expect(payload.variables.TIME_ZONE).toBe('EDT / New York');
    expect(payload.variables.HOST).toBe('Synckre Team');
    expect(payload.variables.MOTIVO).toBeUndefined();
  });

  it('construye payload de alerta interna con id 256c273c-1059-41d4-894e-3b3aaa8aca4a y variables oficiales', () => {
    const payload = buildInternalAlertTemplatePayload({
      action: 'New Appointment',
      attendeeName: 'Carlos Mendoza',
      attendeeEmail: 'carlos@test.com',
      start: new Date('2026-09-08T10:00:00.000Z'),
      end: new Date('2026-09-08T11:00:00.000Z'),
      meetLink: 'https://meet.google.com/test',
      notes: 'Demo de producto',
      conversationId: 'conv-1234',
    });

    expect(payload.templateId).toBe(RESEND_TEMPLATES.INTERNAL_ALERT);
    expect(payload.variables.TITLE).toBe('New Appointment');
    expect(payload.variables.SUMMARY).toContain('Demo de producto');
    expect(payload.variables.DETAILS).toContain('Cliente: Carlos Mendoza');
    expect(payload.variables.DETAILS).toContain('Email: carlos@test.com');
    expect(payload.variables.REFERENCE).toBe('conv-1234');
    expect(payload.variables.ACTION_LINK).toBe('https://synckre.com/conversations/conv-1234');
    expect((payload as { html?: string }).html).toBeUndefined();
  });
});

