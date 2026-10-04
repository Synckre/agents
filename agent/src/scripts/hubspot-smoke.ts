/**
 * Smoke test de HubSpot contra un portal real.
 *
 * Ejercita la ruta crítica del agent **sin pasar por el LLM**:
 *   token → búsqueda → creación → lectura por ID → nota → objeto de citas
 *   → (opcional) crear reprogramar y cancelar una cita.
 *
 * Es seguro por defecto: no crea citas salvo que se pase `--appointments`,
 * porque una cita de prueba deja rastro en el calendario del equipo.
 *
 * Uso:
 *   npm run hubspot:smoke
 *   npm run hubspot:smoke -- --appointments
 *   npm run hubspot:smoke -- --email otro@test.com --quiet
 */
import { env } from '@config/env';
import { HubspotHttpClient } from '@adapters/crm/hubspot/hubspot-http.client';
import { HubspotCrmAdapter } from '@adapters/crm/hubspot/hubspot-crm.adapter';
import { HubspotSchedulingAdapter } from '@adapters/crm/hubspot/hubspot-scheduling.adapter';
import { CrmError } from '@core/ports/crm.port';
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

interface StepResult {
  readonly step: string;
  readonly status: 'ok' | 'skipped' | 'failed';
  readonly detail: string;
  readonly ms: number;
}

interface SmokeOptions {
  readonly email: string;
  readonly withAppointments: boolean;
  readonly quiet: boolean;
}

/**
 * Dominio real de la empresa: HubSpot rechaza TLD reservados como `.test`
 * (INVALID_EMAIL), así que el contacto de prueba usa la dirección corporativa.
 */
const DEFAULT_EMAIL = 'smoke-test@synckre.com';

/** HubSpot valida el email en servidor; se comprueba antes para no gastar la llamada. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && !/\.(test|invalid|example|localhost)$/i.test(value);
}

function parseArgs(argv: string[]): SmokeOptions {
  const emailIndex = argv.indexOf('--email');
  const email = emailIndex >= 0 && argv[emailIndex + 1] ? argv[emailIndex + 1] : DEFAULT_EMAIL;
  return {
    email,
    withAppointments: argv.includes('--appointments'),
    quiet: argv.includes('--quiet'),
  };
}

class SmokeRunner {
  private readonly results: StepResult[] = [];
  private readonly crm: HubspotCrmAdapter;
  private readonly scheduling: HubspotSchedulingAdapter;

  constructor(
    client: HubspotHttpClient,
    private readonly options: SmokeOptions,
  ) {
    this.crm = new HubspotCrmAdapter({
      client,
      defaultSource: HUBSPOT_CONTACT_SOURCE,
      defaultOwnerId: HUBSPOT_OWNER_ID,
      noteContactAssociationTypeId: HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID,
      // Sin caché: el smoke debe verificar contra el portal en cada paso.
      searchCacheTtlMs: 0,
    });
    this.scheduling = new HubspotSchedulingAdapter({
      client,
      appointmentObjectType: HUBSPOT_APPOINTMENT_OBJECT,
      appointmentContactAssociationTypeId: HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID,
    });
  }

  async run(): Promise<StepResult[]> {
    const lead = await this.step('findLead (email)', () => this.crm.findLead({ email: this.options.email }));

    let leadId = lead?.id;
    if (leadId) {
      this.record('crear contacto', 'skipped', `ya existe un contacto con ${this.options.email} (id ${leadId})`);
    } else {
      const created = await this.step('crear contacto', () =>
        this.crm.createLead({
          name: 'Smoke Test Synckre',
          email: this.options.email,
          phone: '+1 555 000 0000',
          companyName: 'Synckre Smoke Test',
          source: 'Smoke Test',
          data: { conversation_id: 'smoke-test' },
        }),
      );
      leadId = created?.id;
    }

    if (!leadId) {
      this.record('lectura por ID', 'skipped', 'no hay lead sobre el que continuar');
    } else {
      await this.step('lectura por ID', () => this.crm.getLeadById(leadId!));

      await this.step('añadir nota', () =>
        this.crm.appendLeadNote(leadId!, {
          body: `Nota de smoke test generada el ${new Date().toISOString()}. Si ves esto, el agent puede escribir notas en HubSpot.`,
          threadId: 'smoke-test',
        }),
      );

      await this.step('actualizar contacto', () =>
        this.crm.updateLead(leadId!, { jobTitle: 'Smoke Test' }),
      );
    }

    await this.step('buscar citas en 30 días', () => {
      const from = new Date();
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return this.scheduling.findAppointments(from, to);
    });

    if (this.options.withAppointments) {
      await this.exerciseAppointments(leadId);
    } else {
      this.record('escritura de citas', 'skipped', 'usa --appointments para probarla');
    }

    return this.results;
  }

  private async exerciseAppointments(leadId?: string): Promise<void> {
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    start.setUTCHours(15, 0, 0, 0);
    const rescheduled = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const created = await this.step('crear cita', () =>
      this.scheduling.createAppointment({
        scheduledTime: start.toISOString(),
        customerName: 'Smoke Test Synckre',
        email: this.options.email,
        phone: '+1 555 000 0000',
        leadId,
        calendarEventId: `smoke-${Date.now()}`,
        appointmentType: 'general',
        durationMinutes: 30,
        notes: 'Cita creada por el smoke test del agent.',
      }),
    );

    if (!created?.id) {
      this.record('reprogramar cita', 'skipped', 'no se creó la cita');
      return;
    }

    await this.step('reprogramar cita', () =>
      this.scheduling.rescheduleAppointment(created.id, rescheduled.toISOString()),
    );

    await this.step('cancelar cita', () => this.scheduling.cancelAppointment(created.id));
  }

  private async step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    const startedAt = Date.now();
    try {
      const value = await fn();
      this.record(name, 'ok', summarize(value), Date.now() - startedAt);
      return value;
    } catch (error) {
      this.record(name, 'failed', describeError(error), Date.now() - startedAt);
      return undefined;
    }
  }

  private record(step: string, status: StepResult['status'], detail: string, ms = 0): void {
    this.results.push({ step, status, detail, ms });
    if (this.options.quiet && status === 'ok') return;
    const icon = status === 'ok' ? '✓' : status === 'skipped' ? '–' : '✗';
    console.log(`${icon} ${step} (${ms}ms): ${detail}`);
  }
}

function summarize(value: unknown): string {
  if (value === null) return 'sin resultados';
  if (value === undefined) return 'sin contenido';
  if (Array.isArray(value)) return `${value.length} elemento(s)`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') {
      const extra = typeof record.email === 'string' ? `, ${record.email}` : '';
      return `id ${record.id}${extra}`;
    }
    return 'ok';
  }
  return String(value);
}

function describeError(error: unknown): string {
  if (error instanceof CrmError) {
    return `${error.code}${error.status ? ` (${error.status})` : ''}${error.correlationId ? ` [${error.correlationId}]` : ''}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  console.log('=== Smoke test de HubSpot ===');
  console.log(`Portal:      ${env.HUBSPOT_API_BASE_URL} (API ${HUBSPOT_API_VERSION})`);
  console.log(`Email test:  ${options.email}`);
  console.log(`Modo:        ${env.CRM_WRITE_MODE}${options.withAppointments ? ' + citas' : ''}`);
  console.log('');

  if (!env.HUBSPOT_PRIVATE_APP_TOKEN?.trim()) {
    console.error('HUBSPOT_PRIVATE_APP_TOKEN no está configurado.');
    process.exit(2);
  }

  if (!isValidEmail(options.email)) {
    console.error(
      `Email de prueba inválido para HubSpot: "${options.email}".\n` +
        'Usa un dominio real (HubSpot rechaza .test/.invalid/.example) y evita el de un cliente.',
    );
    process.exit(2);
  }

  if (env.CRM_WRITE_MODE === 'dry_run') {
    console.warn(
      'Aviso: CRM_WRITE_MODE=dry_run. Este script construye los adaptadores reales y SÍ escribe; el flag solo afecta al agent.\n',
    );
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
  client.assertReady();

  const results = await new SmokeRunner(client, options).run();

  const failed = results.filter((r) => r.status === 'failed');
  console.log('');
  console.log(
    `Resultado: ${results.filter((r) => r.status === 'ok').length} ok, ${
      results.filter((r) => r.status === 'skipped').length
    } omitidos, ${failed.length} fallidos.`,
  );

  if (failed.length > 0) {
    console.log('');
    console.log('Fallos:');
    for (const result of failed) {
      console.log(`  - ${result.step}: ${result.detail}`);
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  console.error('[smoke] error fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
