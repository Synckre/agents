import {
  DayHours,
  SchedulingPolicy,
  WeekdayKey,
} from '../scheduling-policy';

export interface ExistingBooking {
  readonly start: Date | string;
  readonly end: Date | string;
  readonly type?: string;
}

export interface AvailableSlot {
  readonly start: string;
  readonly end: string;
}

export interface ComputeSlotsRange {
  readonly from: Date | string;
  readonly to: Date | string;
}

export interface ComputeSlotsOptions {
  readonly maxSlots?: number;
}

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  weekday: WeekdayKey;
  dateStr: string; // YYYY-MM-DD
  hour: number;
  minute: number;
}

const WEEKDAY_MAP: Record<string, WeekdayKey> = {
  mon: 'mon',
  tue: 'tue',
  wed: 'wed',
  thu: 'thu',
  fri: 'fri',
  sat: 'sat',
  sun: 'sun',
};

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekdayStr = '';

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
    else if (part.type === 'weekday') weekdayStr = part.value.toLowerCase();
  }

  if (hour === 24) hour = 0;

  const weekday = WEEKDAY_MAP[weekdayStr.slice(0, 3)] ?? 'mon';
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, weekday, dateStr, hour, minute };
}

/**
 * Convierte una fecha y hora local en una zona horaria a un Date UTC exacto.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = getZonedDateParts(utcGuess, timeZone);
  const localGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);

  const diff = utcGuess.getTime() - localGuess;
  return new Date(utcGuess.getTime() + diff);
}

/**
 * Calcula determinísticamente los slots disponibles respetando:
 * 1. Horarios de atención por día de la semana.
 * 2. Días festivos / cerrados.
 * 3. Capacidad máxima diaria (si aplica).
 * 4. Duración y concurrencia por tipo de cita.
 * 5. Solapamiento con citas y eventos ocupados existentes.
 */
export function computeAvailableSlots(
  policy: SchedulingPolicy,
  existingBookings: readonly ExistingBooking[],
  range: ComputeSlotsRange,
  appointmentTypeId?: string,
  options: ComputeSlotsOptions = {},
): AvailableSlot[] {
  const fromDate = new Date(range.from);
  const toDate = new Date(range.to);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    return [];
  }

  // 1. Determinar tipo de cita y duración
  const appointmentType =
    (appointmentTypeId && policy.appointmentTypes[appointmentTypeId]) ||
    policy.appointmentTypes['general'] ||
    Object.values(policy.appointmentTypes)[0] || {
      id: 'default',
      durationMinutes: 30,
      maxConcurrent: 1,
    };

  const durationMs = appointmentType.durationMinutes * 60_000;
  const stepMs = (policy.slotIntervalMinutes ?? appointmentType.durationMinutes) * 60_000;
  const maxSlots = options.maxSlots ?? 48;

  // 2. Normalizar reservas existentes
  const normalizedBookings = existingBookings
    .map((b) => {
      const startMs = new Date(b.start).getTime();
      const endMs = new Date(b.end).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
      const parts = getZonedDateParts(new Date(startMs), policy.timezone);
      return { startMs, endMs, dateStr: parts.dateStr, type: b.type };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  // Conteo de reservas por fecha en la zona horaria de la empresa
  const bookingsPerDay = new Map<string, number>();
  for (const b of normalizedBookings) {
    bookingsPerDay.set(b.dateStr, (bookingsPerDay.get(b.dateStr) ?? 0) + 1);
  }

  const holidaysSet = new Set(policy.holidays);
  const slots: AvailableSlot[] = [];

  // 3. Iterar día por día dentro del rango
  // Empezamos desde el inicio del día local de 'fromDate'
  const fromParts = getZonedDateParts(fromDate, policy.timezone);
  const toParts = getZonedDateParts(toDate, policy.timezone);

  let currentLocalDay = zonedTimeToUtc(fromParts.dateStr, '00:00', policy.timezone);
  const endLocalDayLimit = zonedTimeToUtc(toParts.dateStr, '23:59', policy.timezone);

  while (currentLocalDay.getTime() <= endLocalDayLimit.getTime() && slots.length < maxSlots) {
    const dayParts = getZonedDateParts(currentLocalDay, policy.timezone);
    const dateStr = dayParts.dateStr;

    // Avanzar un día en el cursor local para el próximo ciclo
    currentLocalDay = new Date(currentLocalDay.getTime() + 24 * 60 * 60 * 1000);

    // Validar feriados
    if (holidaysSet.has(dateStr)) {
      continue;
    }

    // Validar día laborable según política
    const dayHours: DayHours | null = policy.hoursByWeekday[dayParts.weekday];
    if (!dayHours) {
      continue;
    }

    // Validar tope máximo de citas por día
    if (
      policy.maxAppointmentsPerDay !== undefined &&
      (bookingsPerDay.get(dateStr) ?? 0) >= policy.maxAppointmentsPerDay
    ) {
      continue;
    }

    const openUtc = zonedTimeToUtc(dateStr, dayHours.open, policy.timezone);
    const closeUtc = zonedTimeToUtc(dateStr, dayHours.close, policy.timezone);

    for (
      let cursorMs = openUtc.getTime();
      cursorMs + durationMs <= closeUtc.getTime() && slots.length < maxSlots;
      cursorMs += stepMs
    ) {
      const slotStartMs = cursorMs;
      const slotEndMs = cursorMs + durationMs;

      // El slot debe caer dentro del rango solicitado por el usuario
      if (slotStartMs < fromDate.getTime() || slotEndMs > toDate.getTime()) {
        continue;
      }

      // Verificar solapamientos y concurrencia
      let overlapping = 0;
      for (const booking of normalizedBookings) {
        if (slotStartMs < booking.endMs && slotEndMs > booking.startMs) {
          overlapping++;
        }
      }

      if (overlapping < appointmentType.maxConcurrent) {
        slots.push({
          start: new Date(slotStartMs).toISOString(),
          end: new Date(slotEndMs).toISOString(),
        });
      }
    }
  }

  return slots;
}
