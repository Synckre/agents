import { describe, expect, it } from 'vitest';
import { buildResendApiPayload } from '@adapters/email/resend.adapter';
import {
  RESEND_TEMPLATE_VAR_MAX,
  sanitizeResendTemplateVariables,
} from '@adapters/email/resend-templates.config';

describe('Resend payload', () => {
  it('exige plantilla y recorta variables a 2000 caracteres', () => {
    const oversized = 'x'.repeat(RESEND_TEMPLATE_VAR_MAX + 80);
    const payload = buildResendApiPayload(
      {
        to: 'ops@example.com',
        subject: 'Alert',
        templateId: 'tmpl-internal',
        variables: {
          NOTES: oversized,
          FIRST_NAME: 'Ada',
          CLIENT_NAME: 'Ada Lovelace',
        },
      },
      'Synckre <noreply@synckre.com>',
    );

    expect(payload.html).toBeUndefined();
    expect(payload.text).toBeUndefined();
    expect(payload.template).toEqual({
      id: 'tmpl-internal',
      variables: {
        NOTES: `${'x'.repeat(RESEND_TEMPLATE_VAR_MAX - 1)}…`,
        CLIENT_NAME: 'Ada Lovelace',
      },
    });
  });

  it('rechaza envíos sin plantilla', () => {
    expect(() =>
      buildResendApiPayload(
        {
          to: 'ops@example.com',
          subject: 'Alert',
          html: '<p>ok</p>',
          templateId: '',
        },
        'Synckre <noreply@synckre.com>',
      ),
    ).toThrow('Emails must use a Resend template');
  });

  it('elimina variables reservadas de Resend', () => {
    const sanitized = sanitizeResendTemplateVariables({
      FIRST_NAME: 'Ada',
      LAST_NAME: 'Lovelace',
      EMAIL: 'ada@example.com',
      UNSUBSCRIBE_URL: 'https://example.com',
      CLIENT_EMAIL: 'ada@example.com',
    });

    expect(sanitized).toEqual({ CLIENT_EMAIL: 'ada@example.com' });
  });
});
