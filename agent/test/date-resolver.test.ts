import { describe, expect, it } from 'vitest';
import { resolveAppointmentRange } from '@adapters/tools/date-resolver';

describe('resolveAppointmentRange', () => {
  const fixedNow = new Date('2026-09-02T12:00:00.000Z');

  it('ajusta automáticamente el año si el LLM envía un año en el pasado (sesgo de entrenamiento)', () => {
    // El LLM envía 2025 por sesgo
    const resolved = resolveAppointmentRange('2025-10-15T10:00:00.000Z', undefined, {
      now: fixedNow,
      defaultDurationMinutes: 60,
    });

    expect(resolved.start.getFullYear()).toBe(2026);
    expect(resolved.start.getMonth()).toBe(9); // Octubre (0-indexed)
    expect(resolved.start.getDate()).toBe(15);
    // End calculado automáticamente a 60 min
    expect(resolved.end.getTime() - resolved.start.getTime()).toBe(60 * 60_000);
  });

  it('calcula la hora de fin automáticamente si no se proporciona', () => {
    const resolved = resolveAppointmentRange('2026-09-05T14:00:00.000Z', undefined, {
      now: fixedNow,
      defaultDurationMinutes: 45,
    });

    expect(resolved.startIso).toBe('2026-09-05T14:00:00-04:00');
    expect(resolved.endIso).toBe('2026-09-05T14:45:00-04:00');
  });

  it('rechaza fechas en el pasado si allowPast es false', () => {
    expect(() =>
      resolveAppointmentRange('2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z', {
        now: fixedNow,
        allowPast: false,
      }),
    ).toThrow(/past/i);
  });

  it('permite fechas en el pasado si allowPast es true (modo test)', () => {
    const resolved = resolveAppointmentRange('2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z', {
      now: fixedNow,
      allowPast: true,
    });
    expect(resolved.start.getFullYear()).toBe(2026);
  });

  it('aplica el offset de la zona horaria (America/New_York) a fechas sin offset o con naive Z', () => {
    const resolved = resolveAppointmentRange('2026-09-03T14:30:00.000Z', undefined, {
      now: fixedNow,
      timeZone: 'America/New_York',
      allowPast: true,
    });

    expect(resolved.startIso).toBe('2026-09-03T14:30:00-04:00');
    expect(resolved.endIso).toBe('2026-09-03T15:30:00-04:00');
  });
});
