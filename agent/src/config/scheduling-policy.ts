import { SchedulingPolicy } from '@core/domain/scheduling-policy';

/**
 * Horario comercial por defecto de Synckre.
 * Es la base sobre la que `ConfigSchedulingPolicyProvider` aplica la configuración de
 * entorno (SCHEDULING_BUSINESS_HOURS), y también el fallback determinista.
 */
export const DEFAULT_BUSINESS_HOURS: SchedulingPolicy['hoursByWeekday'] = {
  mon: { open: '09:00', close: '18:00' },
  tue: { open: '09:00', close: '18:00' },
  wed: { open: '09:00', close: '18:00' },
  thu: { open: '09:00', close: '18:00' },
  fri: { open: '09:00', close: '18:00' },
  sat: null,
  sun: null,
};

/**
 * Política de disponibilidad por defecto de Synckre.
 * No depende de red: la configuración vive en variables de entorno (SCHEDULING_*)
 * y este objeto es el fallback cuando no hay configuración explícita.
 */
export const DEFAULT_SCHEDULING_POLICY: SchedulingPolicy = {
  timezone: process.env.SCHEDULING_TIMEZONE || process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/New_York',
  hoursByWeekday: DEFAULT_BUSINESS_HOURS,
  holidays: [
    // Feriados federales estándar EEUU (año en curso / base)
    '2026-01-01', // New Year's Day
    '2026-01-19', // Martin Luther King Jr. Day
    '2026-02-16', // Presidents' Day
    '2026-05-25', // Memorial Day
    '2026-06-19', // Juneteenth
    '2026-07-04', // Independence Day
    '2026-09-07', // Labor Day
    '2026-10-12', // Columbus Day
    '2026-11-11', // Veterans Day
    '2026-11-26', // Thanksgiving Day
    '2026-12-25', // Christmas Day
  ],
  appointmentTypes: {
    general: {
      id: 'general',
      name: 'Reunión General',
      durationMinutes: 30,
      maxConcurrent: 1,
    },
    consultation: {
      id: 'consultation',
      name: 'Consultoría Técnica',
      durationMinutes: 45,
      maxConcurrent: 1,
    },
    demo: {
      id: 'demo',
      name: 'Demostración de Producto',
      durationMinutes: 30,
      maxConcurrent: 1,
    },
  },
  maxAppointmentsPerDay: 8,
  slotIntervalMinutes: 30,
};
