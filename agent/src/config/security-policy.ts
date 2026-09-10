export const SECURITY_POLICY = {
  toolRateLimits: {
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
  },
  minContextMessagesForSensitiveTools: 2,
  maxAppointmentsPerConversation: 3,
} as const;

export type ToolWithRateLimit = keyof typeof SECURITY_POLICY.toolRateLimits;
