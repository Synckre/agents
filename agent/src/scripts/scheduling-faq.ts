/**
 * Regenera la sección de política de agendamiento dentro del FAQ.
 *
 * El FAQ es un fichero que se ingiere en la base de conocimiento, así que si los
 * horarios o las duraciones se escribieran a mano quedarían obsoletos en cuanto
 * alguien editara la política desde el panel. Este script rellena el bloque
 * delimitado con los datos VIGENTES.
 *
 * Uso:
 *   npm run knowledge:faq            # reescribe el bloque del FAQ
 *   npm run knowledge:faq -- --check # falla si el bloque está desactualizado (para CI)
 *
 * Después, para que el agent lo use:
 *   npm run ingest
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { PostgresSchedulingPolicyProvider } from '@adapters/persistence/postgres-scheduling-policy.adapter';
import { ConfigSchedulingPolicyProvider } from '@adapters/crm/config-scheduling-policy.provider';
import { renderSchedulingPolicyFaq } from '@core/domain/scheduling-policy-description';
import { env } from '@config/env';

const BEGIN = '<!-- BEGIN:scheduling-policy (generado por `npm run knowledge:faq` — no editar a mano) -->';
const END = '<!-- END:scheduling-policy -->';
const FAQ_PATH = path.resolve('knowledge/public/faq.md');

function parseArgs(argv: string[]): { check: boolean } {
  return { check: argv.includes('--check') };
}

/** Política de respaldo: la del entorno, que es también la semilla de la base de datos. */
function environmentPolicy() {
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

  const fromEnv = environmentPolicy();

  // La política vigente es la de la base de datos si está configurada; el entorno
  // es el respaldo, exactamente igual que en tiempo de ejecución del agent.
  let policy = fromEnv.currentPolicy();
  if (env.DATABASE_URL) {
    const pool = createPgPool(env.DATABASE_URL);
    try {
      const provider = new PostgresSchedulingPolicyProvider(pool, {
        fallback: fromEnv.currentPolicy(),
        cacheTtlMs: 0,
      });
      policy = await provider.getPolicy();
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  const source = env.DATABASE_URL ? 'base de datos (con respaldo del entorno)' : 'entorno';
  const rendered = renderSchedulingPolicyFaq(policy, { locale: 'es' });
  const current = await readFile(FAQ_PATH, 'utf-8');

  const startIndex = current.indexOf(BEGIN);
  const endIndex = current.indexOf(END);

  if (startIndex === -1 || endIndex === -1) {
    console.error(
      `El FAQ no contiene los marcadores del bloque generado.\n  ${BEGIN}\n  ${END}`,
    );
    process.exit(2);
  }

  const updated =
    current.slice(0, startIndex + BEGIN.length) + '\n' + rendered + '\n' + current.slice(endIndex);

  if (args.check) {
    if (updated !== current) {
      console.error(
        'El FAQ está desactualizado respecto a la política vigente.\n' +
          'Ejecuta `npm run knowledge:faq` para regenerarlo.',
      );
      process.exit(1);
    }
    console.log('El FAQ está al día con la política vigente.');
    return;
  }

  if (updated === current) {
    console.log(`Sin cambios: el FAQ ya refleja la política vigente (origen: ${source}).`);
    return;
  }

  await writeFile(FAQ_PATH, updated, 'utf-8');
  console.log(`FAQ actualizado desde la política vigente (origen: ${source}).`);
  console.log('');
  console.log(rendered);
  console.log('');
  console.log('Recuerda ingerirlo para que el agent lo use:  npm run ingest');
}

void main().catch((error: unknown) => {
  console.error('[knowledge:faq] error fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
