import { GoogleCalendarAdapter } from '@adapters/google/calendar.adapter';
import { GoogleAdapter } from '@adapters/google/google.adapter';
import { ErpNextAdapter } from '@adapters/crm/erpnext.adapter';
import { ErpNextSchedulingAdapter } from '@adapters/crm/erpnext-scheduling.adapter';
import { ResendAdapter } from '@adapters/email/resend.adapter';
import { env } from '@config/env';

export interface ExternalAdapters {
  readonly crm: ErpNextAdapter;
  readonly calendar: GoogleCalendarAdapter;
  readonly google: GoogleAdapter;
  readonly email: ResendAdapter;
  readonly scheduling: ErpNextSchedulingAdapter;
  readonly internalAlertEmail: string;
}

export function buildExternalAdapters(): ExternalAdapters {
  const crm = new ErpNextAdapter({
    baseUrl: env.ERPNEXT_URL,
    apiKey: env.ERPNEXT_API_KEY,
    apiSecret: env.ERPNEXT_API_SECRET,
  });

  const scheduling = new ErpNextSchedulingAdapter({
    baseUrl: env.ERPNEXT_URL,
    apiKey: env.ERPNEXT_API_KEY,
    apiSecret: env.ERPNEXT_API_SECRET,
    defaultTimezone: env.GOOGLE_CALENDAR_TIMEZONE,
  });

  const google = new GoogleAdapter({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  });

  const calendar = new GoogleCalendarAdapter(google, {
    calendarId: env.GOOGLE_CALENDAR_ID,
    timeZone: env.GOOGLE_CALENDAR_TIMEZONE,
  });

  const email = new ResendAdapter({
    apiKey: env.RESEND_API_KEY,
    defaultFrom: env.EMAIL_FROM,
  });

  return {
    crm,
    calendar,
    google,
    email,
    scheduling,
    internalAlertEmail: env.INTERNAL_ALERT_EMAIL,
  };
}
