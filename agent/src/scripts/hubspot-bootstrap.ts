/**
 * Bootstrap de HubSpot para AgentSynckre.
 *
 * Verifica y, si hace falta, crea la estructura mínima que necesita el agent:
 *   1. Token de Private App válido y con los scopes requeridos.
 *   2. Propiedades personalizadas de contacto (`synckre_*`).
 *   3. Objeto de citas (nativo `appointments` o el custom object configurado).
 *   4. Tipos de asociación cita -> contacto y nota -> contacto.
 *
 * Es idempotente: puede ejecutarse tantas veces como haga falta.
 *
 * Uso:
 *   npm run hubspot:bootstrap              # verifica y crea lo que falte
 *   npm run hubspot:bootstrap -- --verify-only   # solo verifica, no escribe
 *   npm run hubspot:bootstrap -- --json          # salida legible por máquina
 */
import { env } from '@config/env';
import { HubspotHttpClient } from '@adapters/crm/hubspot/hubspot-http.client';
import { CrmError } from '@core/ports/crm.port';
import { OPTIONAL_CONTACT_PROPERTIES } from '@adapters/crm/hubspot/hubspot-mapping';
import {
  HUBSPOT_API_VERSION,
  HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID,
  HUBSPOT_APPOINTMENT_OBJECT,
  HUBSPOT_MAX_RETRIES,
  HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID,
  HUBSPOT_REQUEST_TIMEOUT_MS,
} from '@config/hubspot.config';

interface CheckResult {
  readonly name: string;
  readonly status: 'ok' | 'created' | 'missing' | 'skipped' | 'error';
  readonly detail: string;
  readonly action?: string;
}

interface HubspotProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
}

/**
 * La API devuelve las colecciones envueltas en `{ results: [...] }`
 * (probado contra el portal: /crm/properties/.../contacts y /groups).
 * Tratarlas como arrays hacía fallar el bootstrap contra el portal real.
 */
function unwrapResults<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const results = (payload as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? (results as T[]) : [];
}

interface AssociationLabel {
  category?: string;
  typeId?: number;
  label?: string;
}

interface AccountDetails {
  portalId?: number;
  accountType?: string;
  uiDomain?: string;
  timeZone?: string;
  currency?: string;
  additionalCurrencies?: string[];
}

const REQUIRED_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.notes.read',
];

const OPTIONAL_SCOPES: Record<string, string> = {
  'crm.schemas.contacts.write': 'necesario para crear las propiedades synckre_* de contacto',
  'crm.objects.appointments.read': 'necesario para leer citas',
  'crm.objects.appointments.write': 'necesario para crear y modificar citas',
  'crm.schemas.appointments.write': 'necesario para crear propiedades del objeto de citas',
};

const CONTACT_PROPERTY_DEFINITIONS: Array<{
  name: string;
  label: string;
  type: string;
  fieldType: string;
  description: string;
}> = [
  {
    name: 'synckre_company_name',
    label: 'Synckre Company Name',
    type: 'string',
    fieldType: 'text',
    description: 'Empresa declarada por el contacto en el formulario o el chat (tal cual).',
  },
  {
    name: 'synckre_topic',
    label: 'Synckre Topic',
    type: 'string',
    fieldType: 'text',
    description: 'Asunto o servicio de interés indicado por el contacto.',
  },
  {
    name: 'synckre_source',
    label: 'Synckre Source',
    type: 'string',
    fieldType: 'text',
    description: 'Canal de origen del lead (Website, Chat, etc.).',
  },
  {
    name: 'synckre_conversation_id',
    label: 'Synckre Conversation ID',
    type: 'string',
    fieldType: 'text',
    description: 'Identificador de la conversación que originó o actualizó el contacto.',
  },
];

const APPOINTMENT_PROPERTY_DEFINITIONS: Array<{
  name: string;
  label: string;
  type: string;
  fieldType: string;
  hasUniqueValue?: boolean;
}> = [
  { name: 'synckre_scheduled_time', label: 'Synckre Scheduled Time', type: 'datetime', fieldType: 'date' },
  { name: 'synckre_scheduled_end', label: 'Synckre Scheduled End', type: 'datetime', fieldType: 'date' },
  { name: 'synckre_status', label: 'Synckre Status', type: 'string', fieldType: 'text' },
  { name: 'synckre_customer_name', label: 'Synckre Customer Name', type: 'string', fieldType: 'text' },
  { name: 'synckre_customer_email', label: 'Synckre Customer Email', type: 'string', fieldType: 'text' },
  { name: 'synckre_customer_phone', label: 'Synckre Customer Phone', type: 'string', fieldType: 'text' },
  {
    name: 'synckre_calendar_event_id',
    label: 'Synckre Calendar Event ID',
    type: 'string',
    fieldType: 'text',
  },
  {
    name: 'synckre_external_id',
    label: 'Synckre External ID',
    type: 'string',
    fieldType: 'text',
    hasUniqueValue: true,
  },
  { name: 'synckre_notes', label: 'Synckre Notes', type: 'string', fieldType: 'textarea' },
];

function maskToken(token?: string): string {
  const value = (token ?? '').trim();
  if (!value) return '(vacío)';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

class HubspotBootstrap {
  private readonly checks: CheckResult[] = [];
  private writeEnabled: boolean;

  constructor(
    private readonly client: HubspotHttpClient,
    private readonly options: { verifyOnly: boolean },
  ) {
    this.writeEnabled = !options.verifyOnly;
  }

  async run(): Promise<CheckResult[]> {
    console.log('=== Bootstrap de HubSpot para AgentSynckre ===');
    console.log(`Base URL:    ${env.HUBSPOT_API_BASE_URL}`);
    console.log(`API version: ${HUBSPOT_API_VERSION}`);
    console.log(`Token:       ${maskToken(env.HUBSPOT_PRIVATE_APP_TOKEN)}`);
    console.log(`Modo:        ${this.options.verifyOnly ? 'solo verificación' : 'verificación + creación'}`);
    console.log('');

    await this.checkCredentials();
    await this.checkContactProperties();
    await this.checkAppointmentObject();
    await this.checkAssociations();
    return this.checks;
  }

  private record(check: CheckResult): void {
    this.checks.push(check);
    const icon =
      check.status === 'ok' ? '✓' : check.status === 'created' ? '+' : check.status === 'skipped' ? '–' : '✗';
    console.log(`${icon} ${check.name}: ${check.detail}`);
  }

  // ---------------------------------------------------------------------------
  // 1. Credenciales y scopes
  // ---------------------------------------------------------------------------
  private async checkCredentials(): Promise<void> {
    if (!env.HUBSPOT_PRIVATE_APP_TOKEN?.trim()) {
      this.record({
        name: 'token',
        status: 'missing',
        detail: 'HUBSPOT_PRIVATE_APP_TOKEN no está configurado',
        action: 'Crea una Private App en HubSpot y pon el token en .env',
      });
      return;
    }

    try {
      const details = await this.client.get<AccountDetails>(
        `/account-info/${HUBSPOT_API_VERSION}/details`,
        { operation: 'accountDetails' },
      );
      this.record({
        name: 'token',
        status: 'ok',
        detail: `portal ${details.portalId ?? '?'} (${details.accountType ?? 'desconocido'}), tz ${
          details.timeZone ?? '?'
        }`,
      });
    } catch (error) {
      this.record({
        name: 'token',
        status: 'error',
        detail: this.describeError(error),
        action: 'Verifica que el token sea válido y no haya sido revocado',
      });
      return;
    }

    // Los scopes efectivos se comprueban por comportamiento: HubSpot no expone
    // un endpoint de introspección de scopes para private apps.
    for (const scope of REQUIRED_SCOPES) {
      await this.checkScopeByProbe(scope);
    }
    for (const [scope, why] of Object.entries(OPTIONAL_SCOPES)) {
      await this.checkOptionalScopeByProbe(scope, why);
    }
  }

  private async checkScopeByProbe(scope: string): Promise<void> {
    const probe = this.probeFor(scope);
    if (!probe) return;
    try {
      await this.client.request(probe.path, { ...probe.options, operation: `probe:${scope}` });
      this.record({ name: `scope ${scope}`, status: 'ok', detail: 'confirmado por sonda de lectura' });
    } catch (error) {
      const forbidden = error instanceof CrmError && error.code === 'CRM_FORBIDDEN';
      this.record({
        name: `scope ${scope}`,
        status: forbidden ? 'missing' : 'error',
        detail: this.describeError(error),
        action: forbidden ? `Añade el scope ${scope} a la Private App` : undefined,
      });
    }
  }

  private async checkOptionalScopeByProbe(scope: string, why: string): Promise<void> {
    const probe = this.probeFor(scope);
    if (!probe) {
      this.record({ name: `scope ${scope}`, status: 'skipped', detail: why });
      return;
    }
    try {
      await this.client.request(probe.path, { ...probe.options, operation: `probe:${scope}` });
      this.record({ name: `scope ${scope}`, status: 'ok', detail: 'confirmado' });
    } catch (error) {
      const forbidden = error instanceof CrmError && error.code === 'CRM_FORBIDDEN';
      this.record({
        name: `scope ${scope}`,
        status: forbidden ? 'missing' : 'error',
        detail: this.describeError(error),
        action: forbidden ? `Añade el scope ${scope}: ${why}` : undefined,
      });
    }
  }

  private probeFor(scope: string): { path: string; options: Record<string, unknown> } | null {
    const v = HUBSPOT_API_VERSION;
    switch (scope) {
      case 'crm.objects.contacts.read':
        return { path: `/crm/objects/${v}/contacts?limit=1&properties=email`, options: {} };
      case 'crm.objects.contacts.write':
        // El listado sólo prueba lectura; la escritura se valida al crear propiedades.
        return { path: `/crm/properties/${v}/contacts?archived=false`, options: {} };
      case 'crm.objects.appointments.read':
        return { path: `/crm/objects/${v}/appointments?limit=1`, options: {} };
      case 'crm.objects.appointments.write':
        return { path: `/crm/properties/${v}/appointments`, options: {} };
      case 'crm.schemas.contacts.write':
      case 'crm.schemas.appointments.write':
        // No hay endpoint de introspección: se comprueba de verdad en la creación
        // de propiedades. Aquí se marca como pendiente de verificar.
        return null;
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Propiedades personalizadas de contacto
  // ---------------------------------------------------------------------------
  private async checkContactProperties(): Promise<void> {
    let existing: HubspotProperty[];
    try {
      existing = unwrapResults<HubspotProperty>(
        await this.client.get(
          `/crm/properties/${HUBSPOT_API_VERSION}/contacts`,
          { operation: 'listContactProperties' },
        ),
      );
    } catch (error) {
      this.record({
        name: 'propiedades de contacto',
        status: 'error',
        detail: `no se pudo listar: ${this.describeError(error)}`,
        action: 'Verifica el scope crm.schemas.contacts.write',
      });
      return;
    }

    const names = new Set(existing.map((p) => p.name));
    const missing = CONTACT_PROPERTY_DEFINITIONS.filter((def) => !names.has(def.name));

    if (missing.length === 0) {
      this.record({
        name: 'propiedades de contacto',
        status: 'ok',
        detail: `las ${OPTIONAL_CONTACT_PROPERTIES.length} propiedades synckre_* existen`,
      });
      return;
    }

    if (!this.writeEnabled) {
      this.record({
        name: 'propiedades de contacto',
        status: 'missing',
        detail: `faltan ${missing.map((m) => m.name).join(', ')}`,
        action: 'Ejecuta sin --verify-only para crearlas',
      });
      return;
    }

    for (const def of missing) {
      try {
        await this.client.post(
          `/crm/properties/${HUBSPOT_API_VERSION}/contacts`,
          {
            groupName: 'contactinformation',
            name: def.name,
            label: def.label,
            type: def.type,
            fieldType: def.fieldType,
            description: def.description,
          },
          { operation: `createContactProperty:${def.name}` },
        );
        this.record({ name: `propiedad ${def.name}`, status: 'created', detail: def.label });
      } catch (error) {
        this.record({
          name: `propiedad ${def.name}`,
          status: 'error',
          detail: this.describeError(error),
          action: 'Créala manualmente en HubSpot > Settings > Properties > Contact properties',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Objeto de citas
  // ---------------------------------------------------------------------------
  private async checkAppointmentObject(): Promise<void> {
    const objectType = HUBSPOT_APPOINTMENT_OBJECT;
    const isCustom = /^\d+-\d+$/.test(objectType);

    if (isCustom) {
      await this.checkCustomAppointmentObject(objectType);
      return;
    }

    try {
      await this.client.get(
        `/crm/objects/${HUBSPOT_API_VERSION}/${objectType}?limit=1`,
        { operation: 'probeAppointmentsObject' },
      );
      this.record({
        name: 'objeto de citas',
        status: 'ok',
        detail: `'${objectType}' accesible (objeto nativo)`,
      });
      await this.checkAppointmentProperties(objectType);
    } catch (error) {
      if (error instanceof CrmError && (error.code === 'CRM_NOT_FOUND' || error.code === 'CRM_FORBIDDEN')) {
        this.record({
          name: 'objeto de citas',
          status: 'missing',
          detail: `'${objectType}' no está disponible (${this.describeError(error)})`,
          action:
            'Activa el objeto Appointments en HubSpot (Data Model Builder) o define HUBSPOT_APPOINTMENT_OBJECT con un objeto personalizado',
        });
        return;
      }
      this.record({
        name: 'objeto de citas',
        status: 'error',
        detail: this.describeError(error),
      });
    }
  }

  private async checkAppointmentProperties(objectType: string): Promise<void> {
    let existing: HubspotProperty[];
    try {
      existing = unwrapResults<HubspotProperty>(
        await this.client.get(
          `/crm/properties/${HUBSPOT_API_VERSION}/${objectType}`,
          { operation: 'listAppointmentProperties' },
        ),
      );
    } catch {
      // El objeto nativo no siempre permite listar propiedades con el scope actual.
      return;
    }

    const names = new Set(existing.map((p) => p.name));
    const required = ['hs_appointment_name', 'hs_appointment_start', 'hs_appointment_end'];
    const missing = required.filter((name) => !names.has(name));
    if (missing.length === 0) {
      this.record({
        name: 'propiedades nativas de cita',
        status: 'ok',
        detail: required.join(', '),
      });
    } else {
      this.record({
        name: 'propiedades nativas de cita',
        status: 'missing',
        detail: `faltan ${missing.join(', ')}`,
        action: 'El objeto appointments no parece estar completamente activado en el portal',
      });
    }

    // El adaptador escribe además metadatos propios (vínculo con Google Calendar,
    // datos del cliente) incluso sobre el objeto nativo: sin estas propiedades,
    // cada cita caería al reintento degradado y se perdería la trazabilidad.
    await this.ensureAppointmentProperties(objectType, existing);
  }

  private async checkCustomAppointmentObject(objectTypeId: string): Promise<void> {
    try {
      await this.client.get(
        `/crm/objects/${HUBSPOT_API_VERSION}/${objectTypeId}?limit=1`,
        { operation: 'probeCustomAppointmentsObject' },
      );
      this.record({ name: 'objeto de citas', status: 'ok', detail: `custom ${objectTypeId} accesible` });
    } catch (error) {
      if (error instanceof CrmError && error.code === 'CRM_NOT_FOUND') {
        this.record({
          name: 'objeto de citas',
          status: 'missing',
          detail: `el custom object ${objectTypeId} no existe`,
          action:
            'Crea el objeto personalizado en HubSpot (requiere Enterprise) y ajusta HUBSPOT_APPOINTMENT_OBJECT',
        });
        return;
      }
      this.record({ name: 'objeto de citas', status: 'error', detail: this.describeError(error) });
      return;
    }

    await this.ensureCustomAppointmentProperties(objectTypeId);
  }

  private async ensureCustomAppointmentProperties(objectTypeId: string): Promise<void> {
    let existing: HubspotProperty[];
    try {
      existing = unwrapResults<HubspotProperty>(
        await this.client.get(
          `/crm/properties/${HUBSPOT_API_VERSION}/${objectTypeId}`,
          { operation: 'listCustomAppointmentProperties' },
        ),
      );
    } catch (error) {
      this.record({
        name: 'propiedades del objeto de citas',
        status: 'error',
        detail: this.describeError(error),
      });
      return;
    }

    await this.ensureAppointmentProperties(objectTypeId, existing);
  }

  /**
   * Crea las propiedades `synckre_*` del objeto de citas si faltan.
   * Es idempotente y no bloqueante: si el portal no permite crearlas, el
   * adaptador sigue operando con el reintento degradado.
   */
  /**
   * Resuelve el grupo de propiedades donde crear las propiedades de cita.
   *
   * El nombre del grupo es específico del objeto y no está en el esquema público,
   * así que se consulta el portal en lugar de asumir un literal: un `groupName`
   * inexistente hace que TODAS las creaciones devuelvan 400.
   */
  private async resolveAppointmentPropertyGroup(objectType: string): Promise<string | null> {
    try {
      const groups = unwrapResults<{ name: string; label?: string }>(
        await this.client.get(
          `/crm/properties/${HUBSPOT_API_VERSION}/${objectType}/groups`,
          { operation: 'listPropertyGroups' },
        ),
      );
      const names = groups.map((g) => g.name);
      if (names.length === 0) return null;
      // Preferencia por el grupo estándar del objeto de citas; si no, el primero.
      return names.includes('appointment_information') ? 'appointment_information' : names[0];
    } catch (error) {
      this.record({
        name: 'grupo de propiedades de cita',
        status: 'error',
        detail: `no se pudo listar: ${this.describeError(error)}`,
        action: 'Verifica el scope crm.schemas.appointments.write',
      });
      return null;
    }
  }

  private async ensureAppointmentProperties(
    objectType: string,
    existing: HubspotProperty[],
  ): Promise<void> {
    const names = new Set(existing.map((p) => p.name));
    const missing = APPOINTMENT_PROPERTY_DEFINITIONS.filter((def) => !names.has(def.name));

    if (missing.length === 0) {
      this.record({
        name: 'propiedades synckre_* de la cita',
        status: 'ok',
        detail: `las ${APPOINTMENT_PROPERTY_DEFINITIONS.length} propiedades existen en ${objectType}`,
      });
      return;
    }

    if (!this.writeEnabled) {
      this.record({
        name: 'propiedades synckre_* de la cita',
        status: 'missing',
        detail: `faltan ${missing.map((m) => m.name).join(', ')}`,
        action: 'Ejecuta sin --verify-only para crearlas',
      });
      return;
    }

    const groupName = await this.resolveAppointmentPropertyGroup(objectType);
    if (!groupName) {
      this.record({
        name: 'propiedades synckre_* de la cita',
        status: 'missing',
        detail: `faltan ${missing.map((m) => m.name).join(', ')} y no se pudo determinar el grupo`,
        action: 'Crea las propiedades manualmente en HubSpot indicando un grupo válido',
      });
      return;
    }

    for (const def of missing) {
      try {
        await this.client.post(
          `/crm/properties/${HUBSPOT_API_VERSION}/${objectType}`,
          {
            groupName,
            name: def.name,
            label: def.label,
            type: def.type,
            fieldType: def.fieldType,
            ...(def.hasUniqueValue ? { hasUniqueValue: true } : {}),
          },
          { operation: `createAppointmentProperty:${def.name}` },
        );
        this.record({ name: `propiedad ${def.name}`, status: 'created', detail: def.label });
      } catch (error) {
        this.record({
          name: `propiedad ${def.name}`,
          status: 'error',
          detail: this.describeError(error),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Asociaciones
  // ---------------------------------------------------------------------------
  private async checkAssociations(): Promise<void> {
    await this.checkAssociationLabel(
      'appointments',
      'contact',
      HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID,
      'HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID',
    );
    await this.checkAssociationLabel(
      'notes',
      'contact',
      HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID,
      'HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID',
    );
  }

  private async checkAssociationLabel(
    from: string,
    to: string,
    configuredTypeId: number,
    envVar: string,
  ): Promise<void> {
    let labels: AssociationLabel[];
    try {
      labels = unwrapResults<AssociationLabel>(
        await this.client.get(
          `/crm/associations/${HUBSPOT_API_VERSION}/${from}/${to}/labels`,
          { operation: `associationLabels:${from}->${to}` },
        ),
      );
    } catch (error) {
      this.record({
        name: `asociación ${from} → ${to}`,
        status: 'error',
        detail: this.describeError(error),
      });
      return;
    }

    const match = labels.find((label) => label.typeId === configuredTypeId);
    if (match) {
      this.record({
        name: `asociación ${from} → ${to}`,
        status: 'ok',
        detail: `typeId ${configuredTypeId} (${match.label ?? 'sin etiqueta'})`,
      });
      return;
    }

    const fallback = labels.find((label) =>
      (label.label ?? '').toLowerCase().includes(`${from.replace(/s$/, '')}_to_${to}`) ||
      (label.label ?? '').toLowerCase().includes('primary'),
    );

    this.record({
      name: `asociación ${from} → ${to}`,
      status: 'missing',
      detail: `typeId ${configuredTypeId} no aparece entre las etiquetas disponibles`,
      action: fallback
        ? `Revisa ${envVar}: candidato typeId ${fallback.typeId} (${fallback.label})`
        : `Verifica ${envVar} en la documentación de HubSpot`,
    });
  }

  private describeError(error: unknown): string {
    if (error instanceof CrmError) {
      return `${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

function parseArgs(argv: string[]): { verifyOnly: boolean; json: boolean } {
  return {
    verifyOnly: argv.includes('--verify-only'),
    json: argv.includes('--json'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!env.HUBSPOT_PRIVATE_APP_TOKEN?.trim()) {
    console.error('HUBSPOT_PRIVATE_APP_TOKEN no está configurado. Añádelo a .env y vuelve a intentarlo.');
    process.exit(2);
  }

  const client = new HubspotHttpClient({
    baseUrl: env.HUBSPOT_API_BASE_URL,
    apiVersion: HUBSPOT_API_VERSION,
    accessToken: env.HUBSPOT_PRIVATE_APP_TOKEN,
    timeoutMs: HUBSPOT_REQUEST_TIMEOUT_MS,
    maxRetries: HUBSPOT_MAX_RETRIES,
  });

  const checks = await new HubspotBootstrap(client, { verifyOnly: args.verifyOnly }).run();

  const failed = checks.filter((c) => c.status === 'missing' || c.status === 'error');

  if (args.json) {
    console.log(JSON.stringify({ checks, failed: failed.length }, null, 2));
  } else {
    console.log('');
    console.log(`Resumen: ${checks.filter((c) => c.status === 'ok').length} ok, ${
      checks.filter((c) => c.status === 'created').length
    } creados, ${failed.length} pendientes/erróneos.`);

    if (failed.length > 0) {
      console.log('');
      console.log('Pendientes:');
      for (const check of failed) {
        console.log(`  - ${check.name}: ${check.detail}`);
        if (check.action) console.log(`    → ${check.action}`);
      }
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error('[bootstrap] error fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
