/**
 * Utilidad de cutover: audita los seguimientos programados frente al CRM nuevo.
 *
 * Motivo: los seguimientos creados **antes** del corte guardan `lead_id` con
 * identificadores del CRM anterior (los `CRM-LEAD-0001` de ERPNext). En HubSpot
 * esos ids no existen, así que el worker no puede resolver el correo del
 * destinatario, lanza error y agota los reintentos uno por uno. Esta utilidad los
 * detecta de golpe para poder decidir qué hacer con ellos.
 *
 * Uso:
 *   npm run followups:audit                 # sólo informa
 *   npm run followups:audit -- --mark       # además marca los huérfanos como fallidos
 *   npm run followups:audit -- --json       # salida legible por máquina
 *
 * Es idempotente y no envía ningún correo.
 */
import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { buildCrmAdapters } from '../bootstrap/build-crm-adapters';
import { env } from '@config/env';

interface FollowupRow {
  lead_id: string;
  pending: string;
  due: string | null;
  oldest: string | null;
}

interface AuditEntry {
  readonly leadId: string;
  readonly pending: number;
  readonly resolvable: boolean;
  readonly email?: string;
  readonly oldestDueAt?: string | null;
}

function parseArgs(argv: string[]): { mark: boolean; json: boolean } {
  return { mark: argv.includes('--mark'), json: argv.includes('--json') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!env.DATABASE_URL) {
    console.error('DATABASE_URL no está configurado: hace falta para leer los seguimientos.');
    process.exit(2);
  }

  const pool = createPgPool(env.DATABASE_URL);
  const { crm, provider } = buildCrmAdapters();

  console.log('=== Auditoría de seguimientos programados frente al CRM ===');
  console.log(`Proveedor de CRM: ${provider}`);

  try {
    // Se agrupan por lead para no resolver el mismo id más de una vez.
    const { rows } = await pool.query<FollowupRow>(
      `SELECT lead_id,
              COUNT(*)::text AS pending,
              MIN(due_at) AS due,
              MIN(due_at) AS oldest
         FROM scheduled_followups
        WHERE status = 'pending'
        GROUP BY lead_id
        ORDER BY MIN(due_at) ASC`,
    );

    if (rows.length === 0) {
      console.log('No hay seguimientos pendientes. Nada que auditar.');
      return;
    }

    console.log(`Lead(s) distintos con seguimientos pendientes: ${rows.length}`);
    console.log('');

    const entries: AuditEntry[] = [];
    for (const row of rows) {
      const lead = await crm.getLeadById(row.lead_id);
      entries.push({
        leadId: row.lead_id,
        pending: Number(row.pending),
        resolvable: Boolean(lead),
        email: lead?.email,
        oldestDueAt: row.due,
      });
    }

    const orphans = entries.filter((e) => !e.resolvable);
    const withoutEmail = entries.filter((e) => e.resolvable && !e.email);

    for (const entry of entries) {
      const state = !entry.resolvable
        ? '✗ HUÉRFANO (no existe en el CRM)'
        : entry.email
          ? '✓ resoluble'
          : '! resoluble pero SIN EMAIL';
      console.log(`  ${entry.leadId}: ${entry.pending} pendiente(s), vence ${entry.oldestDueAt ?? '?'} -> ${state}`);
    }

    console.log('');
    console.log(
      `Resumen: ${entries.length - orphans.length - withoutEmail.length} resolubles, ` +
        `${orphans.length} huérfanos, ${withoutEmail.length} sin email.`,
    );

    if (orphans.length > 0) {
      console.log('');
      console.log(
        'Los huérfanos conservan identificadores del CRM anterior. El worker fallará con\n' +
          'cada uno hasta agotar los reintentos. Opciones:\n' +
          '  - Marcarlos como fallidos ahora, con --mark, para que dejen de reintentarse.\n' +
          '  - Reasignar su lead_id al contacto equivalente en el CRM nuevo y volver a ponerlos\n' +
          '    en estado pending (requiere revisar caso por caso).',
      );
    }

    if (args.mark && orphans.length > 0) {
      const ids = orphans.map((o) => o.leadId);
      const { rowCount } = await pool.query(
        `UPDATE scheduled_followups
            SET status = 'failed',
                error = COALESCE(error, '') || '[cutover] lead_id no existe en el CRM nuevo',
                updated_at = now()
          WHERE status = 'pending' AND lead_id = ANY($1::text[])`,
        [ids],
      );
      console.log('');
      console.log(`Marcados como fallidos: ${rowCount ?? 0} seguimiento(s).`);
    } else if (orphans.length > 0) {
      console.log('');
      console.log('(Sin cambios: usa --mark para marcarlos como fallidos.)');
    }

    if (args.json) {
      console.log('');
      console.log(JSON.stringify({ provider, entries, orphans: orphans.length, withoutEmail: withoutEmail.length }, null, 2));
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error('[followups:audit] error fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
