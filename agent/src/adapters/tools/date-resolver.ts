export interface ResolveDateOptions {
  readonly defaultDurationMinutes?: number;
  readonly timeZone?: string;
  readonly allowPast?: boolean;
  readonly now?: Date;
}

export interface ResolvedAppointmentRange {
  readonly start: Date;
  readonly end: Date;
  readonly startIso: string;
  readonly endIso: string;
}

function getTzOffsetString(date: Date, timeZone: string): string {
  try {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
    const offsetMinutes = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const hours = String(Math.floor(abs / 60)).padStart(2, '0');
    const mins = String(abs % 60).padStart(2, '0');
    return `${sign}${hours}:${mins}`;
  } catch {
    return 'Z';
  }
}

function toTzIso(date: Date, timeZone: string, rawInput: string): string {
  if (/[+-]\d{2}:\d{2}$/.test(rawInput)) {
    return rawInput;
  }
  const offset = getTzOffsetString(date, timeZone);
  const match = rawInput.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/);
  if (match) {
    const d = match[1];
    const t = match[2].length === 5 ? `${match[2]}:00` : match[2];
    return `${d}T${t}${offset}`;
  }
  return date.toISOString();
}

/**
 * Normaliza y valida determinísticamente las fechas de agendamiento.
 * Corrige sesgos de año del LLM, calcula la duración automáticamente si falta 'end',
 * alinea la zona horaria de la empresa y valida contra el pasado.
 */
export function resolveAppointmentRange(
  rawStart: string,
  rawEnd?: string,
  options: ResolveDateOptions = {},
): ResolvedAppointmentRange {
  const timeZone = options.timeZone ?? process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'America/New_York';
  const now = options.now ?? new Date();
  const currentYear = now.getFullYear();
  const defaultDuration = options.defaultDurationMinutes ?? 60;

  // Si viene con naive Z o sin offset, resolvemos el ISO con el offset de la zona horaria
  const startIsoWithTz = toTzIso(new Date(rawStart), timeZone, rawStart);
  const start = new Date(startIsoWithTz);

  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid start date: "${rawStart}". Expected valid ISO-8601 string.`);
  }

  // Corrección determinista de año (si el LLM usó un año anterior por sesgo de entrenamiento)
  if (start.getFullYear() < currentYear) {
    start.setFullYear(currentYear);
    if (start.getTime() < now.getTime() - 10 * 60_000) {
      start.setFullYear(currentYear + 1);
    }
  }

  let end: Date;
  let endIsoWithTz: string;
  if (!rawEnd) {
    end = new Date(start.getTime() + defaultDuration * 60_000);
    const endMatch = startIsoWithTz.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})?/);
    if (endMatch) {
      const offset = endMatch[3] ?? getTzOffsetString(end, timeZone);
      const endTzString = new Date(end).toLocaleTimeString('en-GB', { timeZone, hour12: false });
      const endDateString = new Intl.DateTimeFormat('en-CA', { timeZone }).format(end);
      endIsoWithTz = `${endDateString}T${endTzString}${offset}`;
    } else {
      endIsoWithTz = end.toISOString();
    }
  } else {
    endIsoWithTz = toTzIso(new Date(rawEnd), timeZone, rawEnd);
    end = new Date(endIsoWithTz);
    if (Number.isNaN(end.getTime()) || end <= start) {
      end = new Date(start.getTime() + defaultDuration * 60_000);
      endIsoWithTz = toTzIso(end, timeZone, end.toISOString());
    } else if (end.getFullYear() < currentYear) {
      end.setFullYear(start.getFullYear());
      if (end <= start) {
        end = new Date(start.getTime() + defaultDuration * 60_000);
      }
      endIsoWithTz = toTzIso(end, timeZone, end.toISOString());
    }
  }

  // Validación contra fechas en el pasado (con margen de tolerancia de 10 minutos)
  if (!options.allowPast && start.getTime() < now.getTime() - 10 * 60_000) {
    throw new Error('Cannot book appointments in the past. Please choose an upcoming date and time.');
  }

  return {
    start,
    end,
    startIso: startIsoWithTz,
    endIso: endIsoWithTz,
  };
}
