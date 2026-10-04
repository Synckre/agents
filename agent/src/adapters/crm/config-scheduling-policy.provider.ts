import { SchedulingPolicy, WeekdayKey } from '@core/domain/scheduling-policy';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { DEFAULT_BUSINESS_HOURS, DEFAULT_SCHEDULING_POLICY } from '@config/scheduling-policy';

export interface ConfigSchedulingPolicyOptions {
  readonly timezone?: string;
  readonly businessHours?: Partial<Record<WeekdayKey, { open: string; close: string } | null>>;
  readonly appointmentTypes?: Record<
    string,
    { name?: string; durationMinutes: number; maxConcurrent?: number }
  >;
  readonly holidays?: readonly string[];
  readonly maxAppointmentsPerDay?: number;
  readonly slotIntervalMinutes?: number;
  readonly cacheTtlMs?: number;
}

/**
 * Proveedor de política de agendamiento basado en configuración.
 *
 * Reemplaza la lectura remota de los DocTypes `Appointment Booking Settings` y
 * `Holiday List` de ERPNext: la política pasa a ser determinista, sin red y sin
 * fallback silencioso, que era el punto más frágil del adaptador anterior.
 */
export class ConfigSchedulingPolicyProvider implements ISchedulingPolicyProvider {
  private cached: SchedulingPolicy | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs: number;

  constructor(private readonly options: ConfigSchedulingPolicyOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
  }

  async getPolicy(): Promise<SchedulingPolicy> {
    const now = Date.now();
    if (this.cached && now < this.cacheExpiresAt) {
      return this.cached;
    }

    const policy = this.build();
    this.cached = policy;
    this.cacheExpiresAt = now + this.cacheTtlMs;
    return policy;
  }

  /** Invalida la caché local para forzar un recálculo en la siguiente consulta. */
  invalidateCache(): void {
    this.cached = null;
    this.cacheExpiresAt = 0;
  }

  /**
   * Construye la política de forma síncrona, sin caché ni espera. Se usa como
   * respaldo cuando la base de datos todavía no tiene configuración, y como
   * origen del sembrado inicial.
   */
  currentPolicy(): SchedulingPolicy {
    return this.build();
  }

  private build(): SchedulingPolicy {
    const base = DEFAULT_SCHEDULING_POLICY;

    const hoursByWeekday = { ...DEFAULT_BUSINESS_HOURS };
    for (const [day, hours] of Object.entries(this.options.businessHours ?? {})) {
      const key = day as WeekdayKey;
      hoursByWeekday[key] = hours
        ? { open: this.normalizeTime(hours.open), close: this.normalizeTime(hours.close) }
        : null;
    }

    const configuredTypes = this.options.appointmentTypes ?? {};
    const appointmentTypes: SchedulingPolicy['appointmentTypes'] =
      Object.keys(configuredTypes).length > 0
        ? Object.fromEntries(
            Object.entries(configuredTypes).map(([id, type]) => [
              id,
              {
                id,
                name: type.name,
                durationMinutes: type.durationMinutes,
                maxConcurrent: type.maxConcurrent ?? 1,
              },
            ]),
          )
        : base.appointmentTypes;

    const fallbackDuration =
      appointmentTypes.general?.durationMinutes ??
      Object.values(appointmentTypes)[0]?.durationMinutes ??
      30;

    const holidays =
      this.options.holidays && this.options.holidays.length > 0
        ? [...this.options.holidays]
        : [...base.holidays];

    return {
      timezone: this.options.timezone || base.timezone,
      hoursByWeekday,
      holidays,
      appointmentTypes,
      maxAppointmentsPerDay: this.options.maxAppointmentsPerDay ?? base.maxAppointmentsPerDay,
      slotIntervalMinutes: this.options.slotIntervalMinutes ?? fallbackDuration,
    };
  }

  private normalizeTime(raw: string): string {
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
}
