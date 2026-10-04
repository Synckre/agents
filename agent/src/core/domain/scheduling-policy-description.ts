import { SchedulingPolicy, WeekdayKey } from './scheduling-policy';

/**
 * Renderiza la política de agendamiento como texto.
 *
 * Es la ÚNICA fuente de verdad del texto: lo usan tanto el FAQ que se ingiere en
 * la base de conocimiento como el contexto que se inyecta en el prompt. Así los
 * horarios y duraciones no pueden quedar obsoletos en un sitio y actualizados en
 * otro cuando alguien edite la política desde el panel.
 */

const WEEKDAY_LABELS: Record<WeekdayKey, { es: string; en: string }> = {
  mon: { es: 'lunes', en: 'Monday' },
  tue: { es: 'martes', en: 'Tuesday' },
  wed: { es: 'miércoles', en: 'Wednesday' },
  thu: { es: 'jueves', en: 'Thursday' },
  fri: { es: 'viernes', en: 'Friday' },
  sat: { es: 'sábado', en: 'Saturday' },
  sun: { es: 'domingo', en: 'Sunday' },
};

const WEEKDAY_ORDER: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface SchedulingPolicyRenderOptions {
  readonly locale?: 'es' | 'en';
  /** Fecha de referencia para listar sólo los festivos que quedan por delante. */
  readonly today?: Date;
}

/** Agrupa días consecutivos con el mismo horario: "lunes a viernes". */
function groupBusinessHours(policy: SchedulingPolicy, locale: 'es' | 'en'): string[] {
  const groups: Array<{ days: WeekdayKey[]; hours: { open: string; close: string } | null }> = [];

  for (const day of WEEKDAY_ORDER) {
    const hours = policy.hoursByWeekday[day] ?? null;
    const last = groups[groups.length - 1];
    const same = last && JSON.stringify(last.hours) === JSON.stringify(hours);
    if (same) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }

  const labels = (days: WeekdayKey[]): string =>
    days.length === 1
      ? WEEKDAY_LABELS[days[0]][locale]
      : `${WEEKDAY_LABELS[days[0]][locale]} ${locale === 'es' ? 'a' : 'to'} ${
          WEEKDAY_LABELS[days[days.length - 1]][locale]
        }`;

  return groups.map((group) =>
    group.hours
      ? `${labels(group.days)}: ${group.hours.open}-${group.hours.close}`
      : `${labels(group.days)}: ${locale === 'es' ? 'cerrado' : 'closed'}`,
  );
}

/** Festivos que aún no han pasado, ordenados. */
function upcomingHolidays(policy: SchedulingPolicy, today: Date): string[] {
  const iso = today.toISOString().slice(0, 10);
  return [...policy.holidays].filter((d) => d >= iso).sort();
}

/**
 * Sección de FAQ en markdown sobre la política de agendamiento.
 * Pensada para ingerirse en la base de conocimiento.
 */
export function renderSchedulingPolicyFaq(
  policy: SchedulingPolicy,
  options: SchedulingPolicyRenderOptions = {},
): string {
  const locale = options.locale ?? 'es';
  const today = options.today ?? new Date();
  const hours = groupBusinessHours(policy, locale);
  const types = Object.values(policy.appointmentTypes);
  const holidays = upcomingHolidays(policy, today);

  const lines: string[] = [];
  lines.push(locale === 'es' ? '### Horario de atención' : '### Business hours');
  lines.push('');
  lines.push(
    locale === 'es'
      ? `Atendemos en la zona horaria **${policy.timezone}**. Horario comercial:`
      : `We operate in the **${policy.timezone}** time zone. Business hours:`,
  );
  lines.push('');
  for (const entry of hours) lines.push(`- ${entry}`);
  lines.push('');

  lines.push(locale === 'es' ? '### Duración de las reuniones' : '### Meeting lengths');
  lines.push('');
  lines.push(
    locale === 'es'
      ? 'Estos son los tipos de reunión disponibles y lo que dura cada uno:'
      : 'These are the available meeting types and how long each one lasts:',
  );
  lines.push('');
  for (const type of types) {
    const name = type.name ?? type.id;
    lines.push(`- **${name}** (\`${type.id}\`): ${type.durationMinutes} ${locale === 'es' ? 'minutos' : 'minutes'}`);
  }
  lines.push('');

  if (policy.maxAppointmentsPerDay !== undefined) {
    lines.push(
      locale === 'es'
        ? `Se aceptan como máximo **${policy.maxAppointmentsPerDay} reuniones por día**, para poder atender bien cada caso.`
        : `We accept at most **${policy.maxAppointmentsPerDay} meetings per day**, so every case gets proper attention.`,
    );
    lines.push('');
  }

  if (policy.slotIntervalMinutes !== undefined) {
    lines.push(
      locale === 'es'
        ? `Los huecos empiezan cada **${policy.slotIntervalMinutes} minutos**.`
        : `Slots start every **${policy.slotIntervalMinutes} minutes**.`,
    );
    lines.push('');
  }

  if (holidays.length > 0) {
    lines.push(
      locale === 'es'
        ? 'No atendemos estos días festivos (próximos):'
        : 'We are closed on these upcoming holidays:',
    );
    lines.push('');
    for (const day of holidays) lines.push(`- ${day}`);
    lines.push('');
  }

  lines.push(
    locale === 'es'
      ? '> La disponibilidad real se consulta en el momento: el horario indica cuándo atendemos, pero los huecos libres dependen también de la agenda del equipo. Pide un rango de fechas y se te confirmarán los huecos reales.'
      : '> Real availability is checked live: business hours tell you when we operate, but free slots also depend on the team calendar. Ask for a date range and you will get the actual free slots.',
  );

  return lines.join('\n');
}

/**
 * Bloque compacto de contexto para el system prompt.
 *
 * Es más corto que la sección de FAQ porque aquí no hace falta explicar, sólo
 * dar los datos exactos para que el modelo no los invente.
 */
export function renderSchedulingPolicyContext(policy: SchedulingPolicy, today = new Date()): string {
  const hours = groupBusinessHours(policy, 'es');
  const types = Object.values(policy.appointmentTypes)
    .map((t) => `${t.name ?? t.id} (${t.id}): ${t.durationMinutes} min`)
    .join('; ');
  const holidays = upcomingHolidays(policy, today);

  const lines = [
    'POLÍTICA DE AGENDAMIENTO VIGENTE (datos exactos; no los inventes ni los contradigas)',
    `- Zona horaria: ${policy.timezone}`,
    `- Horario comercial: ${hours.join(' | ')}`,
    `- Tipos de reunión: ${types || '(sin tipos configurados)'}`,
  ];

  if (policy.maxAppointmentsPerDay !== undefined) {
    lines.push(`- Máximo de reuniones por día: ${policy.maxAppointmentsPerDay}`);
  }
  if (policy.slotIntervalMinutes !== undefined) {
    lines.push(`- Los huecos empiezan cada ${policy.slotIntervalMinutes} minutos`);
  }
  lines.push(
    holidays.length > 0
      ? `- Próximos días cerrados: ${holidays.slice(0, 8).join(', ')}${holidays.length > 8 ? ` (+${holidays.length - 8} más)` : ''}`
      : '- Sin días cerrados configurados',
  );
  lines.push(
    '- Para responder por horarios, duraciones o festivos usa estos datos. Para ofrecer huecos concretos, la única fuente válida sigue siendo check_availability.',
  );

  return lines.join('\n');
}
