import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresSchedulingPolicyProvider } from '../src/adapters/persistence/postgres-scheduling-policy.adapter';
import { DEFAULT_SCHEDULING_POLICY } from '../src/config/scheduling-policy';
import { SchedulingPolicy } from '../src/core/domain/scheduling-policy';

/**
 * Pool falso que responde a las consultas del proveedor. Se despacha por el
 * texto de la consulta en lugar de por orden de llamada, para que los tests
 * expresen el estado de la base de datos y no una secuencia.
 */
function fakePool(state: {
  settings?: { timezone: string; max: number | null; slot: number | null } | null;
  hours?: Array<{ weekday: string; isOpen: boolean; open: string | null; close: string | null }>;
  types?: Array<{ id: string; name: string | null; duration: number; maxConcurrent: number }>;
  holidays?: string[];
  failOn?: RegExp;
}) {
  const query = vi.fn(async (sql: string) => {
    if (state.failOn?.test(sql)) throw new Error('database unavailable');

    if (/FROM scheduling_settings/.test(sql)) {
      // La consulta de existencia usa EXISTS.
      if (/EXISTS/.test(sql)) return { rows: [{ exists: state.settings != null }] };
      return {
        rows: state.settings
          ? [
              {
                timezone: state.settings.timezone,
                max_appointments_per_day: state.settings.max,
                slot_interval_minutes: state.settings.slot,
              },
            ]
          : [],
      };
    }
    if (/FROM scheduling_business_hours/.test(sql)) {
      return {
        rows: (state.hours ?? []).map((h) => ({
          weekday: h.weekday,
          is_open: h.isOpen,
          open_time: h.open,
          close_time: h.close,
        })),
      };
    }
    if (/FROM scheduling_appointment_types/.test(sql)) {
      return {
        rows: (state.types ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          duration_minutes: t.duration,
          max_concurrent: t.maxConcurrent,
        })),
      };
    }
    if (/FROM scheduling_holidays/.test(sql)) {
      return { rows: (state.holidays ?? []).map((d) => ({ holiday_date: d })) };
    }
    return { rows: [] };
  });

  return { pool: { query } as unknown as Pool, query };
}

const FALLBACK: SchedulingPolicy = DEFAULT_SCHEDULING_POLICY;

describe('PostgresSchedulingPolicyProvider', () => {
  it('usa el respaldo cuando la base de datos no tiene política configurada', async () => {
    const { pool } = fakePool({ settings: null });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe(FALLBACK.timezone);
    expect(policy.hoursByWeekday).toEqual(FALLBACK.hoursByWeekday);
    expect(Object.keys(policy.appointmentTypes).sort()).toEqual(
      Object.keys(FALLBACK.appointmentTypes).sort(),
    );
  });

  it('la base de datos manda cuando está configurada', async () => {
    const { pool } = fakePool({
      settings: { timezone: 'Europe/Madrid', max: 4, slot: 20 },
      hours: [
        { weekday: 'mon', isOpen: true, open: '9:00', close: '17:30' },
        { weekday: 'sat', isOpen: true, open: '10:00', close: '13:00' },
      ],
      types: [{ id: 'demo', name: 'Demo', duration: 45, maxConcurrent: 2 }],
      holidays: ['2027-01-06'],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe('Europe/Madrid');
    expect(policy.maxAppointmentsPerDay).toBe(4);
    expect(policy.slotIntervalMinutes).toBe(20);
    // Las horas de un solo dígito se normalizan.
    expect(policy.hoursByWeekday.mon).toEqual({ open: '09:00', close: '17:30' });
    expect(policy.hoursByWeekday.sat).toEqual({ open: '10:00', close: '13:00' });
    // Un día sin fila se considera cerrado cuando la base de datos manda.
    expect(policy.hoursByWeekday.tue).toBeNull();
    expect(policy.appointmentTypes).toEqual({
      demo: { id: 'demo', name: 'Demo', durationMinutes: 45, maxConcurrent: 2 },
    });
    expect(policy.holidays).toEqual(['2027-01-06']);
  });

  it('respeta una lista de festivos vacía como "sin festivos"', async () => {
    // Con la base de datos como autoridad, vacío es una decisión, no un olvido:
    // no debe reponerse con los festivos por defecto.
    const { pool } = fakePool({
      settings: { timezone: 'UTC', max: null, slot: null },
      hours: [{ weekday: 'mon', isOpen: true, open: '09:00', close: '18:00' }],
      types: [{ id: 'general', name: null, duration: 30, maxConcurrent: 1 }],
      holidays: [],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });

    const policy = await provider.getPolicy();

    expect(policy.holidays).toEqual([]);
    expect(FALLBACK.holidays.length).toBeGreaterThan(0);
  });

  it('cae a los horarios por defecto si no hay ninguno configurado y avisa', async () => {
    const logger = { warn: vi.fn() };
    const { pool } = fakePool({
      settings: { timezone: 'UTC', max: 8, slot: 30 },
      hours: [],
      types: [{ id: 'general', name: null, duration: 30, maxConcurrent: 1 }],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0, logger });

    const policy = await provider.getPolicy();

    // Un borrado accidental no debe dejar la agenda cerrada para siempre.
    expect(policy.hoursByWeekday).toEqual(FALLBACK.hoursByWeekday);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no business hours'));
  });

  it('cae a los tipos de cita por defecto si no hay ninguno y avisa', async () => {
    const logger = { warn: vi.fn() };
    const { pool } = fakePool({
      settings: { timezone: 'UTC', max: 8, slot: 30 },
      hours: [{ weekday: 'mon', isOpen: true, open: '09:00', close: '18:00' }],
      types: [],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0, logger });

    const policy = await provider.getPolicy();

    expect(Object.keys(policy.appointmentTypes).sort()).toEqual(
      Object.keys(FALLBACK.appointmentTypes).sort(),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no appointment types'));
  });

  it('no lanza si la base de datos falla: opera con los valores por defecto', async () => {
    const logger = { warn: vi.fn() };
    const { pool } = fakePool({ failOn: /scheduling_settings/ });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0, logger });

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe(FALLBACK.timezone);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not load the policy'),
      expect.anything(),
    );
  });

  it('cachea la política y permite invalidarla tras un cambio', async () => {
    const { pool, query } = fakePool({
      settings: { timezone: 'UTC', max: 8, slot: 30 },
      hours: [{ weekday: 'mon', isOpen: true, open: '09:00', close: '18:00' }],
      types: [{ id: 'general', name: null, duration: 30, maxConcurrent: 1 }],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 60_000 });

    await provider.getPolicy();
    const callsAfterFirst = query.mock.calls.length;
    await provider.getPolicy();
    // La segunda lectura sale de caché.
    expect(query.mock.calls.length).toBe(callsAfterFirst);

    provider.invalidateCache();
    await provider.getPolicy();
    expect(query.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('sin límite ni intervalo configurados, deduce el intervalo de la duración', async () => {
    const { pool } = fakePool({
      settings: { timezone: 'UTC', max: null, slot: null },
      hours: [{ weekday: 'mon', isOpen: true, open: '09:00', close: '18:00' }],
      types: [{ id: 'demo', name: null, duration: 45, maxConcurrent: 1 }],
    });
    const provider = new PostgresSchedulingPolicyProvider(pool, { cacheTtlMs: 0 });

    const policy = await provider.getPolicy();

    expect(policy.maxAppointmentsPerDay).toBeUndefined();
    expect(policy.slotIntervalMinutes).toBe(45);
  });
});
