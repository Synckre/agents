import { describe, expect, it } from 'vitest';
import { SECURITY_POLICY } from '@config/security-policy';

describe('SECURITY_POLICY configuration', () => {
  it('contiene los parámetros de negocio tipados con los valores requeridos', () => {
    expect(SECURITY_POLICY.toolRateLimits).toEqual({
      send_email: 2,
      save_lead: 3,
      schedule_appointment: 3,
      reschedule_appointment: 3,
      cancel_appointment: 2,
      append_lead_note: 5,
      search_lead: 10,
      check_availability: 10,
      search_knowledge_base: 10,
      request_human: 2,
      schedule_followup: 3,
    });

    expect(SECURITY_POLICY.minContextMessagesForSensitiveTools).toBe(2);
    expect(SECURITY_POLICY.maxAppointmentsPerConversation).toBe(3);
  });
});
