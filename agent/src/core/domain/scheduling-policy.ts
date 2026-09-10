export interface DayHours {
  /** Hora de apertura en formato HH:mm (ej. "09:00") */
  readonly open: string;
  /** Hora de cierre en formato HH:mm (ej. "18:00") */
  readonly close: string;
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface AppointmentType {
  readonly id: string;
  readonly name?: string;
  readonly durationMinutes: number;
  readonly maxConcurrent: number;
}

export interface SchedulingPolicy {
  /** Zona horaria oficial para las citas (ej. "America/New_York") */
  readonly timezone: string;
  /** Horarios de atención por día de la semana. null indica día cerrado */
  readonly hoursByWeekday: Record<WeekdayKey, DayHours | null>;
  /** Fechas festivas o inhábiles en formato ISO YYYY-MM-DD */
  readonly holidays: readonly string[];
  /** Tipos de citas permitidas con su duración y concurrencia */
  readonly appointmentTypes: Record<string, AppointmentType>;
  /** Capacidad máxima de citas permitidas por día (opcional) */
  readonly maxAppointmentsPerDay?: number;
  /** Intervalo en minutos entre el inicio de cada slot candidato (por defecto la duración de la cita o 30) */
  readonly slotIntervalMinutes?: number;
}
