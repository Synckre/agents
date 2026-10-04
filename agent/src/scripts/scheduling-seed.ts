/**
 * Siembra la política de agendamiento en la base de datos.
 *
 * La política deja de depender de variables de entorno para poder administrarse
 * desde un panel. Este script vuelca la configuración actual (la de entorno, o
 * los valores por defecto) en las tablas.
 *
 * Uso:
 *   npm run scheduling:seed            # sólo siembra si la política no existe
 *   npm run scheduling:seed -- --force # sobrescribe la política existente
 *   npm run scheduling:show            # muestra la política vigente y de dónde sale
 *
 * Es idempotente y no borra nada salvo que se pase --force.
 */
import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { POSTGRES_SCHEMA_SQL } from '@adapters/persistence/postgres-schema';
import { PostgresSchedulingPolicyProvider } from '@adapters/persistence/postgres-scheduling-policy.adapter';
import { ConfigSchedulingPolicyProvider } from '@adapters/crm/config-scheduling-policy.provider';
import { env } from '@config/env';

function parseArgs(argv: string[]): { force: boolean; show: boolean } {
  return { force: argv.includes('--force'), show: argv.includes('--show') };
}

/** Construye la política a partir del entorno (o de los valores por defecto). */
function fromEnvironment() {
  return new ConfigSchedulingPolicyProvider({
    timezone: env.SCHEDULING_TIMEZONE,
    businessHours: env.SCHEDULING_BUSINESS_HOURS ?? undefined,
    appointmentTypes: env.SCHEDULING_APPOINTMENT_TYPES ?? undefined,
    holidays: env.SCHEDULING_HOLIDAYS,
    maxAppointmentsPerDay: env.SCHEDULING_MAX_APPOINTMENTS_PER_DAY,
    slotIntervalMinutes: env.SCHEDULING_SLOT_INTERVAL_MINUTES,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurado.');
    process.exit(2);
  }

  const pool = createPgPool(env.DATABASE_URL);
  const config = fromEnvironment();

  try {
    // Este script sirve para poner en marcha el sistema, así que garantiza que
    // las tablas existan sin depender de que otro adaptador las haya creado.
    await pool.query(POSTGRES_SCHEMA_SQL);

    if (args.show) {
      const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });
      const configured = await hasDatabasePolicy(pool);
      const policy = await provider.getPolicy();

      console.log('=== Política de agendamiento vigente ===');
      console.log(`Origen: ${configured ? 'BASE DE DATOS' : 'valores por defecto (base de datos sin configurar)'}`);
      printPolicy(policy);
      return;
    }

    const alreadyConfigured = await hasDatabasePolicy(pool);

    if (alreadyConfigured && !args.force) {
      console.log('La política ya está configurada en la base de datos. No se toca nada.');
      console.log('Usa --force para sobrescribirla con la configuración del entorno.');
      const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });
      printPolicy(await provider.getPolicy());
      return;
    }

    const policy = await config.getPolicy();
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });

    await provider.save({
      timezone: policy.timezone,
      maxAppointmentsPerDay: policy.maxAppointmentsPerDay ?? null,
      slotIntervalMinutes: policy.slotIntervalMinutes ?? null,
      hoursByWeekday: policy.hoursByWeekday,
      appointmentTypes: Object.fromEntries(
        Object.entries(policy.appointmentTypes).map(([id, type]) => [
          id,
          { name: type.name, durationMinutes: type.durationMinutes, maxConcurrent: type.maxConcurrent },
        ]),
      ),
      holidays: policy.holidays,
    });

    console.log(alreadyConfigured ? 'Política sobrescrita.' : 'Política sembrada.');
    printPolicy(await provider.getPolicy());
    console.log('');
    console.log('A partir de ahora la base de datos manda: editar estas tablas cambia la agenda.');
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function hasDatabasePolicy(pool: ReturnType<typeof createPgPool>): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM scheduling_settings WHERE id = 'default') AS exists`,
  );
  return rows[0]?.exists === true;
}

function printPolicy(policy: {
  timezone: string;
  hoursByWeekday: Record<string, { open: string; close: string } | null>;
  appointmentTypes: Record<string, { durationMinutes: number; maxConcurrent: number; name?: string }>;
  holidays: readonly string[];
  maxAppointmentsPerDay?: number;
  slotIntervalMinutes?: number;
}): void {
  console.log('');
  console.log(`  Zona horaria:        ${policy.timezone}`);
  console.log(`  Máx. citas/día:      ${policy.maxAppointmentsPerDay ?? '(sin límite)'}`);
  console.log(`  Intervalo de slot:   ${policy.slotIntervalMinutes ?? '(por defecto)'} min`);
  console.log('  Horario:');
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const hours = policy.hoursByWeekday[day];
    console.log(`    ${day}: ${hours ? `${hours.open}-${hours.close}` : 'cerrado'}`);
  }
  console.log('  Tipos de cita:');
  for (const [id, type] of Object.entries(policy.appointmentTypes)) {
    console.log(`    ${id}: ${type.durationMinutes} min (${type.name ?? 'sin nombre'})`);
  }
  console.log(`  Festivos: ${policy.holidays.length === 0 ? '(ninguno)' : policy.holidays.length}`);
}

void main().catch((error: unknown) => {
  console.error('[scheduling:seed] error fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
