import { GoogleCalendarAdapter } from '@adapters/google/calendar.adapter';
import { GoogleAdapter } from '@adapters/google/google.adapter';
import { ResendAdapter } from '@adapters/email/resend.adapter';
import type { Pool } from 'pg';
import { buildCrmAdapters } from './build-crm-adapters';
import { env } from '@config/env';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ICrm } from '@core/ports/crm.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';

export interface ExternalAdapters {
  readonly crm: ICrm;
  readonly calendar: GoogleCalendarAdapter;
  readonly google: GoogleAdapter;
  readonly email: ResendAdapter;
  /** Proveedor de política de agendamiento y repositorio de citas. */
  readonly scheduling: ISchedulingPolicyProvider & IAppointmentRepository;
  readonly internalAlertEmail: string;
  /** Proveedor de CRM activo, para logs y health checks. */
  readonly crmProvider: 'hubspot' | 'erpnext';
  readonly crmWriteMode: 'live' | 'dry_run';
}

/**
 * Construye todos los adaptadores externos: Google, email y CRM.
 * La selección de proveedor de CRM vive en `buildCrmAdapters()` para que el
 * worker de seguimientos use exactamente el mismo criterio.
 */
export function buildExternalAdapters(pool?: Pool): ExternalAdapters {
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

  const crmAdapters = buildCrmAdapters(pool);

  return {
    crm: crmAdapters.crm,
    calendar,
    google,
    email,
    scheduling: crmAdapters.scheduling,
    internalAlertEmail: env.INTERNAL_ALERT_EMAIL ?? '',
    crmProvider: crmAdapters.provider,
    crmWriteMode: crmAdapters.writeMode,
  };
}
