import { DayHours, SchedulingPolicy, WeekdayKey } from '@core/domain/scheduling-policy';

/**
 * Parseo tolerante de la configuración de agendamiento por variables de entorno.
 *
 * Estas variables son SOLO la semilla inicial y el respaldo: la fuente de verdad
 * es la base de datos. Por eso, si vienen mal formadas:
 *   - no se interrumpe el arranque (el servicio debe seguir vivo con la política
 *     de la base de datos o con los valores por defecto), y
 *   - se deja un aviso claro en los logs.
 *
 * Se aceptan dos formatos:
 *
 *   1. Compacto (recomendado): sin comillas, llaves ni comas anidadas, así que
 *      sobrevive a Coolify, Docker Compose, systemd y cualquier shell.
 *        SCHEDULING_BUSINESS_HOURS=mon=09:00-18:00,tue=09:00-18:00,sat=closed
 *        SCHEDULING_APPOINTMENT_TYPES=general=30,demo=30:Demostración
 *
 *   2. JSON (compatibilidad con configuraciones anteriores). Es frágil en
 *      paneles de despliegue porque las comillas suelen perderse, así que se
 *      mantiene solo para no romper lo que ya funcionaba.
 */

const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface SchedulingParseWarning {
  readonly variable: string;
  readonly message: string;
}

function warn(variable: string, message: string): void {
  console.warn(`[env] ${variable} ${message}. Se usará la política de la base de datos o los valores por defecto.`);
}

/** ¿Parece JSON? Solo entonces se intenta parsear como tal. */
function looksLikeJson(raw: string): boolean {
  return raw.startsWith('{') || raw.startsWith('[');
}

/**
 * Horario comercial.
 * Compacto: `mon=09:00-18:00,tue=09:00-18:00,sat=closed` (o `sat=-` para cerrado).
 */
export function parseBusinessHours(
  raw: string | undefined,
  variable = 'SCHEDULING_BUSINESS_HOURS',
): Partial<Record<WeekdayKey, DayHours | null>> | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const hours: Partial<Record<WeekdayKey, DayHours | null>> = {};
      for (const day of WEEKDAYS) {
        const entry = parsed[day];
        if (entry === undefined) continue;
        if (entry === null) {
          hours[day] = null;
          continue;
        }
        const record = entry as { open?: unknown; close?: unknown };
        if (typeof record.open !== 'string' || typeof record.close !== 'string') {
          warn(variable, 'tiene un JSON válido pero con un formato inesperado');
          return undefined;
        }
        hours[day] = { open: record.open, close: record.close };
      }
      return hours;
    } catch {
      warn(variable, 'parece JSON pero no se pudo interpretar');
      return undefined;
    }
  }

  // Formato compacto.
  const hours: Partial<Record<WeekdayKey, DayHours | null>> = {};
  for (const chunk of value.split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator <= 0) {
      warn(variable, `no se pudo interpretar "${part}" (se espera dia=HH:MM-HH:MM o dia=closed)`);
      return undefined;
    }
    const day = part.slice(0, separator).trim().toLowerCase() as WeekdayKey;
    const spec = part.slice(separator + 1).trim();
    if (!WEEKDAYS.includes(day)) {
      warn(variable, `contiene un día desconocido: "${day}"`);
      return undefined;
    }
    if (/^(closed|-|none|null|cerrado)$/i.test(spec)) {
      hours[day] = null;
      continue;
    }
    const range = spec.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!range) {
      warn(variable, `no se pudo interpretar el horario "${spec}" de ${day}`);
      return undefined;
    }
    hours[day] = { open: range[1], close: range[2] };
  }

  if (Object.keys(hours).length === 0) {
    warn(variable, 'está vacía o no contiene ningún día');
    return undefined;
  }
  return hours;
}

/**
 * Tipos de cita.
 * Compacto: `general=30,demo=30:Demostración,consultation=45:Consultoría`
 * El nombre es opcional (`id=minutos[:Nombre]`).
 */
export function parseAppointmentTypes(
  raw: string | undefined,
  variable = 'SCHEDULING_APPOINTMENT_TYPES',
): Record<string, { name?: string; durationMinutes: number; maxConcurrent: number }> | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  if (looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value) as Record<
        string,
        { name?: unknown; durationMinutes?: unknown; maxConcurrent?: unknown }
      >;
      const types: Record<string, { name?: string; durationMinutes: number; maxConcurrent: number }> = {};
      for (const [id, entry] of Object.entries(parsed)) {
        const duration = Number(entry?.durationMinutes);
        if (!Number.isFinite(duration) || duration <= 0) {
          warn(variable, `tiene el tipo "${id}" sin una duración válida`);
          return undefined;
        }
        types[id] = {
          ...(typeof entry?.name === 'string' ? { name: entry.name } : {}),
          durationMinutes: duration,
          maxConcurrent: Number(entry?.maxConcurrent) > 0 ? Number(entry.maxConcurrent) : 1,
        };
      }
      return Object.keys(types).length > 0 ? types : undefined;
    } catch {
      warn(variable, 'parece JSON pero no se pudo interpretar');
      return undefined;
    }
  }

  // Formato compacto.
  const types: Record<string, { name?: string; durationMinutes: number; maxConcurrent: number }> = {};
  for (const chunk of value.split(',')) {
    const part = chunk.trim();
    if (!part) continue;
    const separator = part.indexOf('=');
    if (separator <= 0) {
      warn(variable, `no se pudo interpretar "${part}" (se espera id=minutos[:Nombre])`);
      return undefined;
    }
    const id = part.slice(0, separator).trim();
    const spec = part.slice(separator + 1).trim();
    const [durationText, ...nameParts] = spec.split(':');
    const duration = Number(durationText);
    if (!id || !Number.isFinite(duration) || duration <= 0) {
      warn(variable, `no se pudo interpretar el tipo "${part}"`);
      return undefined;
    }
    const name = nameParts.join(':').trim();
    types[id] = {
      ...(name ? { name } : {}),
      durationMinutes: duration,
      maxConcurrent: 1,
    };
  }

  if (Object.keys(types).length === 0) {
    warn(variable, 'está vacía o no contiene ningún tipo');
    return undefined;
  }
  return types;
}

/** Indica si una política tiene días cerrados y cuáles, para los avisos. */
export function describePolicy(policy: SchedulingPolicy): string {
  const open = WEEKDAYS.filter((d) => (policy.hoursByWeekday[d] ?? null) !== null);
  return `${open.length} día(s) con atención, ${Object.keys(policy.appointmentTypes).length} tipo(s) de cita`;
}
