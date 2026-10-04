import { describe, expect, it } from 'vitest';
import { ConfigSchedulingPolicyProvider } from '../src/adapters/crm/config-scheduling-policy.provider';
import { DEFAULT_SCHEDULING_POLICY } from '../src/config/scheduling-policy';

describe('ConfigSchedulingPolicyProvider', () => {
  it('devuelve la política por defecto cuando no hay configuración', async () => {
    const provider = new ConfigSchedulingPolicyProvider();

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe(DEFAULT_SCHEDULING_POLICY.timezone);
    expect(policy.hoursByWeekday).toEqual(DEFAULT_SCHEDULING_POLICY.hoursByWeekday);
    expect(policy.maxAppointmentsPerDay).toBe(DEFAULT_SCHEDULING_POLICY.maxAppointmentsPerDay);
  });

  it('aplica el horario comercial configurado y respeta los días cerrados', async () => {
    const provider = new ConfigSchedulingPolicyProvider({
      timezone: 'Europe/Madrid',
      businessHours: {
        mon: { open: '8:00', close: '17:30' },
        sat: { open: '10:00', close: '14:00' },
        sun: null,
      },
    });

    const policy = await provider.getPolicy();

    expect(policy.timezone).toBe('Europe/Madrid');
    // Normaliza horas con un dígito.
    expect(policy.hoursByWeekday.mon).toEqual({ open: '08:00', close: '17:30' });
    expect(policy.hoursByWeekday.sat).toEqual({ open: '10:00', close: '14:00' });
    expect(policy.hoursByWeekday.sun).toBeNull();
    // Los días no configurados conservan el valor por defecto.
    expect(policy.hoursByWeekday.tue).toEqual(DEFAULT_SCHEDULING_POLICY.hoursByWeekday.tue);
  });

  it('construye los tipos de cita configurados con maxConcurrent por defecto', async () => {
    const provider = new ConfigSchedulingPolicyProvider({
      appointmentTypes: {
        discovery: { name: 'Discovery', durationMinutes: 20 },
        deepdive: { name: 'Deep dive', durationMinutes: 90, maxConcurrent: 2 },
      },
    });

    const policy = await provider.getPolicy();

    expect(policy.appointmentTypes.discovery).toEqual({
      id: 'discovery',
      name: 'Discovery',
      durationMinutes: 20,
      maxConcurrent: 1,
    });
    expect(policy.appointmentTypes.deepdive.maxConcurrent).toBe(2);
    // El intervalo de slot cae a la duración del tipo general si no se especifica.
    expect(policy.slotIntervalMinutes).toBe(20);
  });

  it('usa los festivos configurados y el intervalo explícito', async () => {
    const provider = new ConfigSchedulingPolicyProvider({
      holidays: ['2026-12-24', '2026-12-31'],
      slotIntervalMinutes: 15,
      maxAppointmentsPerDay: 4,
    });

    const policy = await provider.getPolicy();

    expect(policy.holidays).toEqual(['2026-12-24', '2026-12-31']);
    expect(policy.slotIntervalMinutes).toBe(15);
    expect(policy.maxAppointmentsPerDay).toBe(4);
  });

  it('no realiza ninguna llamada de red (a diferencia del adaptador de ERPNext)', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = async () => {
      throw new Error('no debería llamarse a la red');
    };
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const provider = new ConfigSchedulingPolicyProvider({ timezone: 'UTC' });
      await expect(provider.getPolicy()).resolves.toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('cachea la política y permite invalidarla explícitamente', async () => {
    const provider = new ConfigSchedulingPolicyProvider({ timezone: 'UTC', cacheTtlMs: 60_000 });

    const first = await provider.getPolicy();
    const second = await provider.getPolicy();
    expect(second).toBe(first);

    provider.invalidateCache();
    const third = await provider.getPolicy();
    expect(third).not.toBe(first);
    expect(third.timezone).toBe('UTC');
  });
});
