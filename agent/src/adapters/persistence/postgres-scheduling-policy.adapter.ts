import type { Pool } from 'pg';
import {
  AppointmentType,
  DayHours,
  SchedulingPolicy,
  WeekdayKey,
} from '@core/domain/scheduling-policy';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { DEFAULT_SCHEDULING_POLICY } from '@config/scheduling-policy';

const WEEKDAYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Fila única de configuración general. */
const SETTINGS_ID = 'default';

export interface PostgresSchedulingPolicyOptions {
  /**
   * Política usada cuando la base de datos todavía no tiene configuración.
   * Normalmente es la derivada del entorno, de modo que el sistema arranca con
   * valores sensatos y la base de datos pasa a mandar en cuanto se siembra.
   */
  readonly fallback?: SchedulingPolicy;
  readonly cacheTtlMs?: number;
  readonly logger?: { warn(message: string, meta?: Record<string, unknown>): void };
}

/** Política parcial aceptada al guardar: sólo se toca lo que se envía. */
export interface SchedulingPolicyUpdate {
  readonly timezone?: string;
  readonly maxAppointmentsPerDay?: number | null;
  readonly slotIntervalMinutes?: number | null;
  readonly hoursByWeekday?: Partial<Record<WeekdayKey, DayHours | null>>;
  readonly appointmentTypes?: Record<string, Omit<AppointmentType, 'id'>>;
  readonly holidays?: readonly string[];
}

/**
 * Proveedor de política de agendamiento respaldado por Postgres.
 *
 * La política deja de vivir en variables de entorno para poder administrarse
 * desde un panel: horarios por día, tipos de cita y festivos son filas
 * independientes.
 *
 * Reglas de autoridad:
 *  - Si NO existe la fila de `scheduling_settings`, la base de datos no está
 *    configurada y se devuelve la política de respaldo (valores por defecto).
 *  - Si existe, la base de datos manda. Aun así, si las tablas de horarios o de
 *    tipos estuvieran vacías se cae al respaldo y se avisa: son datos sin los
 *    que el agendamiento no puede funcionar, y es más probable un borrado
 *    accidental que una intención real de no atender nunca.
 *  - Los festivos vacíos SÍ se respetan como "sin festivos".
 */
export class PostgresSchedulingPolicyProvider implements ISchedulingPolicyProvider {
  private cached: SchedulingPolicy | null = null;
  private cacheExpiresAt = 0;
  private readonly fallback: SchedulingPolicy;
  private readonly cacheTtlMs: number;
  private readonly logger: { warn(message: string, meta?: Record<string, unknown>): void };

  constructor(
    private readonly pool: Pool,
    options: PostgresSchedulingPolicyOptions = {},
  ) {
    this.fallback = options.fallback ?? DEFAULT_SCHEDULING_POLICY;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
    this.logger = options.logger ?? { warn: (message, meta) => console.warn(message, meta ?? '') };
  }

  async getPolicy(): Promise<SchedulingPolicy> {
    const now = Date.now();
    if (this.cached && now < this.cacheExpiresAt) {
      return this.cached;
    }

    let policy: SchedulingPolicy;
    try {
      policy = await this.load();
    } catch (error) {
      // La agenda no puede caerse porque la base de datos tenga un problema:
      // se opera con los valores por defecto y se avisa.
      this.logger.warn('[scheduling] could not load the policy from the database; using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
      policy = this.fallback;
    }

    this.cached = policy;
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return policy;
  }

  /** Invalida la caché local; un panel debe llamarlo tras guardar cambios. */
  invalidateCache(): void {
    this.cached = null;
    this.cacheExpiresAt = 0;
  }

  /**
   * Guarda una política (total o parcial). Es la API de escritura que usaría un
   * panel de configuración; el sembrado inicial también pasa por aquí.
   * Es idempotente.
   */
  async save(update: SchedulingPolicyUpdate): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const current = await this.loadSettings(client);
      const timezone = update.timezone ?? current?.timezone ?? this.fallback.timezone;
      const maxPerDay =
        update.maxAppointmentsPerDay !== undefined
          ? update.maxAppointmentsPerDay
          : (current?.maxAppointmentsPerDay ?? this.fallback.maxAppointmentsPerDay ?? null);
      const slotInterval =
        update.slotIntervalMinutes !== undefined
          ? update.slotIntervalMinutes
          : (current?.slotIntervalMinutes ?? this.fallback.slotIntervalMinutes ?? null);

      await client.query(
        `INSERT INTO scheduling_settings (id, timezone, max_appointments_per_day, slot_interval_minutes, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE
           SET timezone = EXCLUDED.timezone,
               max_appointments_per_day = EXCLUDED.max_appointments_per_day,
               slot_interval_minutes = EXCLUDED.slot_interval_minutes,
               updated_at = now()`,
        [SETTINGS_ID, timezone, maxPerDay, slotInterval],
      );

      if (update.hoursByWeekday) {
        for (const [day, hours] of Object.entries(update.hoursByWeekday)) {
          const key = day as WeekdayKey;
          if (!WEEKDAYS.includes(key)) continue;
          await client.query(
            `INSERT INTO scheduling_business_hours (weekday, is_open, open_time, close_time, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (weekday) DO UPDATE
               SET is_open = EXCLUDED.is_open,
                   open_time = EXCLUDED.open_time,
                   close_time = EXCLUDED.close_time,
                   updated_at = now()`,
            [key, hours !== null, hours?.open ?? null, hours?.close ?? null],
          );
        }
      }

      if (update.appointmentTypes) {
        let order = 0;
        for (const [id, type] of Object.entries(update.appointmentTypes)) {
          order += 1;
          await client.query(
            `INSERT INTO scheduling_appointment_types
               (id, name, duration_minutes, max_concurrent, enabled, sort_order, updated_at)
             VALUES ($1, $2, $3, $4, true, $5, now())
             ON CONFLICT (id) DO UPDATE
               SET name = EXCLUDED.name,
                   duration_minutes = EXCLUDED.duration_minutes,
                   max_concurrent = EXCLUDED.max_concurrent,
                   enabled = true,
                   sort_order = EXCLUDED.sort_order,
                   updated_at = now()`,
            [id, type.name ?? null, type.durationMinutes, type.maxConcurrent, order],
          );
        }
      }

      if (update.holidays) {
        await client.query('DELETE FROM scheduling_holidays');
        for (const date of update.holidays) {
          await client.query(
            `INSERT INTO scheduling_holidays (holiday_date) VALUES ($1)
             ON CONFLICT (holiday_date) DO NOTHING`,
            [date],
          );
        }
      }

      await client.query('COMMIT');
      this.invalidateCache();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  private async load(): Promise<SchedulingPolicy> {
    const settings = await this.loadSettings(this.pool);

    // Sin configuración en base de datos, mandan los valores por defecto.
    if (!settings) return this.fallback;

    const [hours, types, holidays] = await Promise.all([
      this.loadHours(),
      this.loadAppointmentTypes(),
      this.loadHolidays(),
    ]);

    const hoursByWeekday = { ...this.fallback.hoursByWeekday };
    if (hours.size === 0) {
      this.logger.warn(
        '[scheduling] no business hours configured in the database; falling back to defaults',
      );
    } else {
      for (const day of WEEKDAYS) {
        const row = hours.get(day);
        // Un día sin fila se considera cerrado cuando la base de datos manda.
        hoursByWeekday[day] = row && row.isOpen && row.open && row.close
          ? { open: row.open, close: row.close }
          : null;
      }
    }

    let appointmentTypes = this.fallback.appointmentTypes;
    if (types.size === 0) {
      this.logger.warn(
        '[scheduling] no appointment types configured in the database; falling back to defaults',
      );
    } else {
      appointmentTypes = Object.fromEntries(types);
    }

    const fallbackSlot =
      Object.values(appointmentTypes)[0]?.durationMinutes ?? this.fallback.slotIntervalMinutes ?? 30;

    return {
      timezone: settings.timezone,
      hoursByWeekday,
      // Con la base de datos como autoridad, una lista vacía significa "sin festivos".
      holidays: holidays,
      appointmentTypes,
      maxAppointmentsPerDay: settings.maxAppointmentsPerDay ?? undefined,
      slotIntervalMinutes: settings.slotIntervalMinutes ?? fallbackSlot,
    };
  }

  private async loadSettings(
    queryable: Pool | { query: Pool['query'] },
  ): Promise<{ timezone: string; maxAppointmentsPerDay: number | null; slotIntervalMinutes: number | null } | null> {
    const { rows } = await queryable.query<{
      timezone: string;
      max_appointments_per_day: number | null;
      slot_interval_minutes: number | null;
    }>(
      `SELECT timezone, max_appointments_per_day, slot_interval_minutes
         FROM scheduling_settings WHERE id = $1`,
      [SETTINGS_ID],
    );

    const row = rows[0];
    if (!row) return null;
    return {
      timezone: row.timezone,
      maxAppointmentsPerDay: row.max_appointments_per_day,
      slotIntervalMinutes: row.slot_interval_minutes,
    };
  }

  private async loadHours(): Promise<
    Map<WeekdayKey, { isOpen: boolean; open: string | null; close: string | null }>
  > {
    const { rows } = await this.pool.query<{
      weekday: string;
      is_open: boolean;
      open_time: string | null;
      close_time: string | null;
    }>(`SELECT weekday, is_open, open_time, close_time FROM scheduling_business_hours`);

    const map = new Map<WeekdayKey, { isOpen: boolean; open: string | null; close: string | null }>();
    for (const row of rows) {
      const key = row.weekday as WeekdayKey;
      if (!WEEKDAYS.includes(key)) continue;
      map.set(key, {
        isOpen: row.is_open,
        // `open_time`/`close_time` son TEXT ('HH:MM'): se normalizan al leer.
        open: this.normalizeTime(row.open_time),
        close: this.normalizeTime(row.close_time),
      });
    }
    return map;
  }

  private async loadAppointmentTypes(): Promise<Map<string, AppointmentType>> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string | null;
      duration_minutes: number;
      max_concurrent: number;
    }>(
      `SELECT id, name, duration_minutes, max_concurrent
         FROM scheduling_appointment_types
        WHERE enabled = true
        ORDER BY sort_order ASC, id ASC`,
    );

    const map = new Map<string, AppointmentType>();
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        ...(row.name ? { name: row.name } : {}),
        durationMinutes: Number(row.duration_minutes),
        maxConcurrent: Number(row.max_concurrent),
      });
    }
    return map;
  }

  private async loadHolidays(): Promise<string[]> {
    // `holiday_date` es DATE; se formatea a YYYY-MM-DD sin desfase de zona horaria.
    const { rows } = await this.pool.query<{ holiday_date: string }>(
      `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS holiday_date
         FROM scheduling_holidays ORDER BY holiday_date ASC`,
    );
    return rows.map((r) => r.holiday_date);
  }

  private normalizeTime(raw: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
}
