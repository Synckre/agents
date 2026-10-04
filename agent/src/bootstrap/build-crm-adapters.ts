import { ErpNextAdapter } from '@adapters/crm/erpnext.adapter';
import { ErpNextSchedulingAdapter } from '@adapters/crm/erpnext-scheduling.adapter';
import { ConfigSchedulingPolicyProvider } from '@adapters/crm/config-scheduling-policy.provider';
import { HubspotHttpClient } from '@adapters/crm/hubspot/hubspot-http.client';
import { HubspotCrmAdapter } from '@adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotSchedulingAdapter } from '@adapters/crm/hubspot/hubspot-scheduling.adapter';
import {
  DryRunAppointmentRepository,
  DryRunCrmAdapter,
  combineScheduling,
} from '@adapters/crm/noop-crm.adapter';
import type { Pool } from 'pg';
import { PostgresSchedulingPolicyProvider } from '@adapters/persistence/postgres-scheduling-policy.adapter';
import { env } from '@config/env';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ICrm } from '@core/ports/crm.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import {
  HUBSPOT_API_VERSION,
  HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID,
  HUBSPOT_APPOINTMENT_OBJECT,
  HUBSPOT_CONTACT_SOURCE,
  HUBSPOT_MAX_RETRIES,
  HUBSPOT_MAX_RPS,
  HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID,
  HUBSPOT_OWNER_ID,
  HUBSPOT_REQUEST_TIMEOUT_MS,
  HUBSPOT_SEARCH_MAX_RPS,
} from '@config/hubspot.config';

export interface CrmAdapters {
  readonly crm: ICrm;
  /** Proveedor de política y repositorio de citas. */
  readonly scheduling: ISchedulingPolicyProvider & IAppointmentRepository;
  readonly provider: 'hubspot' | 'erpnext';
  readonly writeMode: 'live' | 'dry_run';
}

/**
 * Punto único de decisión de proveedor de CRM.
 *
 * Tanto el servidor (`buildExternalAdapters`) como el worker de seguimientos
 * (`worker.ts`) construyen el CRM desde aquí, para que el flag de rollback
 * `CRM_PROVIDER` no pueda divergir entre procesos.
 *
 * `pool` es opcional: cuando existe, la política de agendamiento se lee de la
 * base de datos (editable desde un panel) y los valores del entorno pasan a ser
 * sólo el respaldo y la semilla inicial. Sin pool (tests, scripts sueltos) se
 * usa directamente la configuración del entorno.
 */
export function buildCrmAdapters(pool?: Pool): CrmAdapters {
  const fromConfig = new ConfigSchedulingPolicyProvider({
    timezone: env.SCHEDULING_TIMEZONE,
    businessHours: env.SCHEDULING_BUSINESS_HOURS ?? undefined,
    appointmentTypes: env.SCHEDULING_APPOINTMENT_TYPES ?? undefined,
    holidays: env.SCHEDULING_HOLIDAYS,
    maxAppointmentsPerDay: env.SCHEDULING_MAX_APPOINTMENTS_PER_DAY,
    slotIntervalMinutes: env.SCHEDULING_SLOT_INTERVAL_MINUTES,
    cacheTtlMs: env.SCHEDULING_POLICY_CACHE_TTL_MS,
  });

  // La base de datos manda cuando está configurada; el entorno es el respaldo.
  // Con base de datos, manda la base de datos; la política del entorno queda como
  // respaldo, de modo que configurar SCHEDULING_* sigue teniendo efecto mientras
  // nadie siembre la política en la base de datos.
  const policy: ISchedulingPolicyProvider = pool
    ? new PostgresSchedulingPolicyProvider(pool, {
        fallback: fromConfig.currentPolicy(),
        cacheTtlMs: env.SCHEDULING_POLICY_CACHE_TTL_MS,
      })
    : fromConfig;

  if (env.CRM_PROVIDER === 'erpnext') {
    const crm = new ErpNextAdapter({
      baseUrl: env.ERPNEXT_URL,
      apiKey: env.ERPNEXT_API_KEY,
      apiSecret: env.ERPNEXT_API_SECRET,
    });

    const erpScheduling = new ErpNextSchedulingAdapter({
      baseUrl: env.ERPNEXT_URL,
      apiKey: env.ERPNEXT_API_KEY,
      apiSecret: env.ERPNEXT_API_SECRET,
      defaultTimezone: env.SCHEDULING_TIMEZONE,
    });

    // La política es siempre la configurada; el repositorio conserva ERPNext
    // para no perder el histórico de citas durante un rollback.
    const scheduling = combineScheduling(policy, erpScheduling);

    if (env.CRM_WRITE_MODE === 'dry_run') {
      return {
        crm: new DryRunCrmAdapter(crm),
        scheduling: combineScheduling(policy, new DryRunAppointmentRepository(scheduling)),
        provider: 'erpnext',
        writeMode: 'dry_run',
      };
    }

    return { crm, scheduling, provider: 'erpnext', writeMode: 'live' };
  }

  const client = new HubspotHttpClient({
    baseUrl: env.HUBSPOT_API_BASE_URL,
    apiVersion: HUBSPOT_API_VERSION,
    accessToken: env.HUBSPOT_PRIVATE_APP_TOKEN,
    timeoutMs: HUBSPOT_REQUEST_TIMEOUT_MS,
    maxRetries: HUBSPOT_MAX_RETRIES,
    maxRequestsPerTenSeconds: HUBSPOT_MAX_RPS,
    maxSearchRequestsPerSecond: HUBSPOT_SEARCH_MAX_RPS,
  });

  // Falla al arrancar, no en la primera conversación, si el despliegue está mal configurado.
  client.assertReady();

  const hubspotCrm = new HubspotCrmAdapter({
    client,
    defaultOwnerId: HUBSPOT_OWNER_ID,
    defaultSource: HUBSPOT_CONTACT_SOURCE,
    noteContactAssociationTypeId: HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID,
  });

  const hubspotScheduling = new HubspotSchedulingAdapter({
    client,
    appointmentObjectType: HUBSPOT_APPOINTMENT_OBJECT,
    appointmentContactAssociationTypeId: HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID,
  });

  const scheduling = combineScheduling(policy, hubspotScheduling);

  if (env.CRM_WRITE_MODE === 'dry_run') {
    return {
      crm: new DryRunCrmAdapter(hubspotCrm),
      scheduling: combineScheduling(policy, new DryRunAppointmentRepository(scheduling)),
      provider: 'hubspot',
      writeMode: 'dry_run',
    };
  }

  return { crm: hubspotCrm, scheduling, provider: 'hubspot', writeMode: 'live' };
}
