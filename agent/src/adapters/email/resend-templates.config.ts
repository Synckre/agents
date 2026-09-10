export const RESEND_TEMPLATES = {
  CONFIRMATION_ES: '08906250-cec8-42a2-ac38-a2406bd21322',
  CONFIRMATION_EN: '90861deb-680f-4cd6-bf06-139a2c470200',
  REMINDER_ES: '6ecc8ddb-69e4-4ccb-9987-2217b23c86cb',
  REMINDER_EN: '2ea00f5b-f5ce-4644-a865-ac4f3d6db526',
  RESCHEDULE_ES: 'f19d1a49-57c0-4903-b497-883b64e9bacf',
  RESCHEDULE_EN: 'b8960688-df18-4f48-89b9-ac19814a2f68',
  CANCEL_ES: '65c13e34-3c51-4609-9afc-69948439c727',
  CANCEL_EN: 'ca5190e6-2585-4bd7-8e64-5fed32a493b0',
  INTERNAL_ALERT: '256c273c-1059-41d4-894e-3b3aaa8aca4a',
  INTERNAL_APPOINTMENT_ES: '2cfbae1a-f956-4410-8320-20937fca0d74',
  INTERNAL_APPOINTMENT_EN: 'cdd4839e-6cfd-4f9d-9001-558eba4c3e38',
  REENGAGE_ES: '7c5905cb-48af-4a57-ba94-9b553f6f77e3',
  REENGAGE_EN: '33a6b4ce-2009-4e38-b6f1-6c0a388a5782',
  ACK_ES: 'acc51d2c-0907-4450-ac8a-72d56e606a98',
  ACK_EN: '6894c871-f340-4bbe-b45c-478115f354ee',
  MESSAGE_ES: '170d0fb1-7046-4f11-b07d-5fe2547cd1ce',
  MESSAGE_EN: '70d97d69-e1e5-4ff2-8872-47708235bf36',
} as const;

export const RESEND_TEMPLATE_VAR_MAX = 2000;
const RESERVED_RESEND_VARIABLES = new Set(['FIRST_NAME', 'LAST_NAME', 'EMAIL', 'UNSUBSCRIBE_URL']);

export function sanitizeResendTemplateVariables(
  variables: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!variables) return out;

  for (const [key, value] of Object.entries(variables)) {
    if (RESERVED_RESEND_VARIABLES.has(key) || value == null) continue;
    let text = typeof value === 'string' ? value : String(value);
    if (text.length > RESEND_TEMPLATE_VAR_MAX) {
      text = `${text.slice(0, RESEND_TEMPLATE_VAR_MAX - 1)}…`;
    }
    out[key] = text;
  }

  return out;
}

export const TEMPLATE_VARIABLES = {
  DATE: 'DATE',
  TIME: 'TIME',
  TIME_ZONE: 'TIME_ZONE',
  HOST: 'HOST',
  REASON: 'REASON',
  RESCHEDULE_LINK: 'RESCHEDULE_LINK',
  CONTACT_LINK: 'CONTACT_LINK',
  CONTACT_TEXT: 'CONTACT_TEXT',
  PREVIOUS_DATE: 'PREVIOUS_DATE',
  PREVIOUS_TIME: 'PREVIOUS_TIME',
  TIME_REMAINING: 'TIME_REMAINING',
  CLIENT_NAME: 'CLIENT_NAME',
  CLIENT_EMAIL: 'CLIENT_EMAIL',
  NOTES: 'NOTES',
  NEXT_STEP: 'NEXT_STEP',
  SUMMARY: 'SUMMARY',
  CTA_LINK: 'CTA_LINK',
  CTA_TEXT: 'CTA_TEXT',
  MEET_LINK: 'MEET_LINK',
  PREVIOUS_SUMMARY: 'PREVIOUS_SUMMARY',
  CONVERSATION_LINK: 'CONVERSATION_LINK',
} as const;

export interface AppointmentEmailData {
  readonly attendeeName: string;
  readonly attendeeEmail?: string;
  readonly start: Date;
  readonly end: Date;
  readonly timeZone?: string;
  readonly meetLink?: string;
  readonly remainingTimeText?: string;
  readonly hostName?: string;
}

export interface RescheduleEmailData extends AppointmentEmailData {
  readonly previousStart: Date;
  readonly previousEnd: Date;
}

export interface CancelEmailData extends AppointmentEmailData {
  readonly reason?: string;
  readonly rescheduleLink?: string;
}

export function buildConfirmationTemplatePayload(
  data: AppointmentEmailData,
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  const timeZone = data.timeZone ?? 'America/New_York';
  const isEs = lang === 'es';

  const dateFormatted = data.start.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTimeFormatted = data.start.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const endTimeFormatted = data.end.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const timeRange = `${startTimeFormatted} – ${endTimeFormatted}`;
  const firstName = data.attendeeName.split(' ')[0] || data.attendeeName;
  const host = data.hostName ?? 'Synckre Team';
  const meetLink = data.meetLink ?? 'https://meet.google.com';

  return {
    templateId: isEs ? RESEND_TEMPLATES.CONFIRMATION_ES : RESEND_TEMPLATES.CONFIRMATION_EN,
    variables: {
      DATE: dateFormatted,
      TIME: timeRange,
      TIME_ZONE: 'EDT / New York',
      HOST: host,
      MEET_LINK: meetLink,
      CLIENT_GIVEN_NAME: firstName,
      CLIENT_NAME: data.attendeeName,
      ...(data.attendeeEmail ? { CLIENT_EMAIL: data.attendeeEmail } : {}),
      CONTACT_LINK: 'https://synckre.com',
      CONTACT_TEXT: 'synckre.com',
      CTA_LINK: 'https://synckre.com',
      CTA_TEXT: 'synckre.com',
    },
  };
}

export function buildReminderTemplatePayload(
  data: AppointmentEmailData,
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  const timeZone = data.timeZone ?? 'America/New_York';
  const isEs = lang === 'es';

  const dateFormatted = data.start.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTimeFormatted = data.start.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const endTimeFormatted = data.end.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const timeRange = `${startTimeFormatted} – ${endTimeFormatted}`;
  const remaining = data.remainingTimeText ?? (isEs ? 'en 24 horas' : 'in 24 hours');
  const firstName = data.attendeeName.split(' ')[0] || data.attendeeName;
  const host = data.hostName ?? 'Synckre Team';
  const meetLink = data.meetLink ?? 'https://meet.google.com';

  return {
    templateId: isEs ? RESEND_TEMPLATES.REMINDER_ES : RESEND_TEMPLATES.REMINDER_EN,
    variables: {
      TIME_REMAINING: remaining,
      DATE: dateFormatted,
      TIME: timeRange,
      TIME_ZONE: 'EDT / New York',
      HOST: host,
      MEET_LINK: meetLink,
      CLIENT_GIVEN_NAME: firstName,
      CLIENT_NAME: data.attendeeName,
      ...(data.attendeeEmail ? { CLIENT_EMAIL: data.attendeeEmail } : {}),
      CONTACT_LINK: 'https://synckre.com',
      CONTACT_TEXT: isEs ? 'synckre.com' : 'synckre.com',
      CTA_LINK: 'https://synckre.com',
      CTA_TEXT: isEs ? 'synckre.com' : 'synckre.com',
    },
  };
}

export function buildRescheduleTemplatePayload(
  data: RescheduleEmailData,
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  const timeZone = data.timeZone ?? 'America/New_York';
  const isEs = lang === 'es';

  const dateFormatted = data.start.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTimeFormatted = data.start.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const endTimeFormatted = data.end.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const prevDateFormatted = data.previousStart.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const prevStartTimeFormatted = data.previousStart.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const prevEndTimeFormatted = data.previousEnd.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const host = data.hostName ?? 'Synckre Team';
  const meetLink = data.meetLink ?? 'https://meet.google.com';
  const firstName = data.attendeeName.split(' ')[0] || data.attendeeName;

  return {
    templateId: isEs ? RESEND_TEMPLATES.RESCHEDULE_ES : RESEND_TEMPLATES.RESCHEDULE_EN,
    variables: {
      PREVIOUS_DATE: prevDateFormatted,
      PREVIOUS_TIME: `${prevStartTimeFormatted} – ${prevEndTimeFormatted}`,
      DATE: dateFormatted,
      TIME: `${startTimeFormatted} – ${endTimeFormatted}`,
      TIME_ZONE: 'EDT / New York',
      HOST: host,
      MEET_LINK: meetLink,
      CLIENT_GIVEN_NAME: firstName,
      CLIENT_NAME: data.attendeeName,
      ...(data.attendeeEmail ? { CLIENT_EMAIL: data.attendeeEmail } : {}),
      CONTACT_LINK: 'https://synckre.com',
      CONTACT_TEXT: 'synckre.com',
      CTA_LINK: 'https://synckre.com',
      CTA_TEXT: 'synckre.com',
    },
  };
}

export function buildCancelTemplatePayload(
  data: CancelEmailData,
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  const timeZone = data.timeZone ?? 'America/New_York';
  const isEs = lang === 'es';

  const dateFormatted = data.start.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const startTimeFormatted = data.start.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const endTimeFormatted = data.end.toLocaleTimeString(isEs ? 'es-ES' : 'en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const host = data.hostName ?? 'Synckre Team';
  const reason = data.reason ?? (isEs ? 'Solicitud del cliente' : 'Client request');
  const rescheduleLink = data.rescheduleLink ?? 'https://synckre.com';
  const firstName = data.attendeeName.split(' ')[0] || data.attendeeName;
  const meetLink = data.meetLink ?? 'https://meet.google.com';

  return {
    templateId: isEs ? RESEND_TEMPLATES.CANCEL_ES : RESEND_TEMPLATES.CANCEL_EN,
    variables: {
      DATE: dateFormatted,
      TIME: `${startTimeFormatted} – ${endTimeFormatted}`,
      TIME_ZONE: 'EDT / New York',
      HOST: host,
      REASON: reason,
      RESCHEDULE_LINK: rescheduleLink,
      MEET_LINK: meetLink,
      CLIENT_GIVEN_NAME: firstName,
      CLIENT_NAME: data.attendeeName,
      ...(data.attendeeEmail ? { CLIENT_EMAIL: data.attendeeEmail } : {}),
      CONTACT_LINK: 'https://synckre.com',
      CONTACT_TEXT: 'synckre.com',
      CTA_LINK: 'https://synckre.com',
      CTA_TEXT: 'synckre.com',
    },
  };
}

export interface InternalAlertEmailData {
  readonly action?: string;
  readonly attendeeName?: string;
  readonly attendeeEmail?: string;
  readonly start?: Date;
  readonly end?: Date;
  readonly previousStart?: Date;
  readonly previousEnd?: Date;
  readonly timeZone?: string;
  readonly meetLink?: string;
  readonly notes?: string;
  readonly reason?: string;
  readonly conversationId?: string;
  readonly summary?: string;
  readonly hostName?: string;
}

export function buildInternalAlertTemplatePayload(
  data: InternalAlertEmailData,
): { templateId: string; variables: Record<string, string> } {
  const action = data.action ?? 'Internal Alert';
  const timeZone = data.timeZone ?? 'America/New_York';
  const details = [
    data.attendeeName ? `Cliente: ${data.attendeeName}` : null,
    data.attendeeEmail ? `Email: ${data.attendeeEmail}` : null,
    data.start
      ? `Fecha: ${data.start.toLocaleDateString('es-ES', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
      : null,
    data.start && data.end
      ? `Hora: ${data.start.toLocaleTimeString('es-ES', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })} – ${data.end.toLocaleTimeString('es-ES', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })}`
      : null,
    data.previousStart
      ? `Antes: ${data.previousStart.toLocaleDateString('es-ES', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
      : null,
    data.meetLink ? `Meet: ${data.meetLink}` : null,
    data.reason ? `Motivo: ${data.reason}` : null,
    data.notes ? `Notas: ${data.notes}` : null,
    data.summary ? `Resumen: ${data.summary}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return {
    templateId: RESEND_TEMPLATES.INTERNAL_ALERT,
    variables: sanitizeResendTemplateVariables({
      STATUS: 'Información',
      TITLE: action,
      SUMMARY: data.summary || data.notes || data.reason || action,
      DETAILS: details || 'Sin detalles adicionales.',
      REFERENCE: data.conversationId ?? 'Sin referencia',
      ACTION_LINK: data.conversationId
        ? `https://synckre.com/conversations/${data.conversationId}`
        : 'https://synckre.com',
      ACTION_TEXT: 'Ver información',
      FOOTER_TEXT: 'Este correo fue generado automáticamente por Synckre.',
    }),
  };
}

export function buildInternalAppointmentTemplatePayload(
  data: AppointmentEmailData & { notes?: string },
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  const timeZone = data.timeZone ?? 'America/New_York';
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const dateFormatted = data.start.toLocaleDateString(locale, {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const startTimeFormatted = data.start.toLocaleTimeString(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const endTimeFormatted = data.end.toLocaleTimeString(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return {
    templateId: lang === 'es' ? RESEND_TEMPLATES.INTERNAL_APPOINTMENT_ES : RESEND_TEMPLATES.INTERNAL_APPOINTMENT_EN,
    variables: sanitizeResendTemplateVariables({
      CLIENT_NAME: data.attendeeName,
      CLIENT_EMAIL: data.attendeeEmail ?? '',
      DATE: dateFormatted,
      TIME: `${startTimeFormatted} – ${endTimeFormatted}`,
      NOTES: data.notes || (lang === 'es' ? 'Sin notas adicionales.' : 'No additional notes.'),
      MEET_LINK: data.meetLink ?? 'https://meet.google.com',
    }),
  };
}

export function buildClientMessageTemplatePayload(
  data: { title: string; message: string; ctaLink?: string; ctaText?: string },
  lang: 'es' | 'en' = 'es',
): { templateId: string; variables: Record<string, string> } {
  return {
    templateId: lang === 'es' ? RESEND_TEMPLATES.MESSAGE_ES : RESEND_TEMPLATES.MESSAGE_EN,
    variables: sanitizeResendTemplateVariables({
      TITLE: data.title,
      MESSAGE: data.message,
      CTA_LINK: data.ctaLink ?? 'https://synckre.com',
      CTA_TEXT: data.ctaText ?? (lang === 'es' ? 'Visitar Synckre' : 'Visit Synckre'),
    }),
  };
}

