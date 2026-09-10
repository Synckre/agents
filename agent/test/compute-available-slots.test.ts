import { describe, expect, it } from 'vitest';
import {
  computeAvailableSlots,
  zonedTimeToUtc,
} from '../src/core/domain/scheduling/compute-available-slots';
import { SchedulingPolicy } from '../src/core/domain/scheduling-policy';

const TEST_POLICY: SchedulingPolicy = {
  timezone: 'America/New_York',
  hoursByWeekday: {
    mon: { open: '09:00', close: '18:00' },
    tue: { open: '09:00', close: '18:00' },
    wed: { open: '09:00', close: '18:00' },
    thu: { open: '09:00', close: '18:00' },
    fri: { open: '09:00', close: '18:00' },
    sat: null,
    sun: null,
  },
  holidays: ['2026-09-07'], // Lunes festivo (ej. Labor Day)
  appointmentTypes: {
    general: { id: 'general', durationMinutes: 30, maxConcurrent: 1 },
    consultation: { id: 'consultation', durationMinutes: 60, maxConcurrent: 1 },
  },
  maxAppointmentsPerDay: 2,
};

describe('computeAvailableSlots (deterministic domain logic)', () => {
  it('convierte correctamente hora local a UTC respetando la zona horaria', () => {
    // 2026-09-08 a las 09:00 EDT (UTC-4) -> 13:00 UTC
    const utcDate = zonedTimeToUtc('2026-09-08', '09:00', 'America/New_York');
    expect(utcDate.toISOString()).toBe('2026-09-08T13:00:00.000Z');
  });

  it('excluye días cerrados (fin de semana)', () => {
    // Sábado 2026-09-05
    const slots = computeAvailableSlots(
      TEST_POLICY,
      [],
      {
        from: '2026-09-05T00:00:00.000Z',
        to: '2026-09-05T23:59:59.000Z',
      },
      'general',
    );
    expect(slots).toHaveLength(0);
  });

  it('excluye días festivos configurados', () => {
    // Lunes 2026-09-07 está en holidays
    const slots = computeAvailableSlots(
      TEST_POLICY,
      [],
      {
        from: '2026-09-07T00:00:00.000Z',
        to: '2026-09-07T23:59:59.000Z',
      },
      'general',
    );
    expect(slots).toHaveLength(0);
  });

  it('genera slots dentro del horario de atención para un día hábil', () => {
    // Martes 2026-09-08
    const from = '2026-09-08T13:00:00.000Z'; // 09:00 EDT
    const to = '2026-09-08T15:00:00.000Z'; // 11:00 EDT
    const slots = computeAvailableSlots(TEST_POLICY, [], { from, to }, 'general');

    // 09:00-09:30, 09:30-10:00, 10:00-10:30, 10:30-11:00 (4 slots de 30m)
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T13:30:00.000Z',
    });
    expect(slots[3]).toEqual({
      start: '2026-09-08T14:30:00.000Z',
      end: '2026-09-08T15:00:00.000Z',
    });
  });

  it('descarta slots que colisionan con reservas existentes', () => {
    const from = '2026-09-08T13:00:00.000Z';
    const to = '2026-09-08T15:00:00.000Z';

    const existingBookings = [
      {
        start: '2026-09-08T13:30:00.000Z',
        end: '2026-09-08T14:00:00.000Z',
      },
    ];

    const slots = computeAvailableSlots(TEST_POLICY, existingBookings, { from, to }, 'general');
    // De 4 slots, 13:30 a 14:00 queda ocupado, deben quedar 3 slots
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.start)).toEqual([
      '2026-09-08T13:00:00.000Z',
      '2026-09-08T14:00:00.000Z',
      '2026-09-08T14:30:00.000Z',
    ]);
  });

  it('respeta el límite de capacidad diaria (maxAppointmentsPerDay)', () => {
    const from = '2026-09-08T13:00:00.000Z';
    const to = '2026-09-08T17:00:00.000Z';

    // TEST_POLICY tiene maxAppointmentsPerDay: 2
    const existingBookings = [
      { start: '2026-09-08T13:00:00.000Z', end: '2026-09-08T13:30:00.000Z' },
      { start: '2026-09-08T14:00:00.000Z', end: '2026-09-08T14:30:00.000Z' },
    ];

    const slots = computeAvailableSlots(TEST_POLICY, existingBookings, { from, to }, 'general');
    // Como ya hay 2 citas ese día, el día entero queda agotado
    expect(slots).toHaveLength(0);
  });

  it('adapta la duración cuando el tipo de cita es consultation (60 min)', () => {
    const from = '2026-09-08T13:00:00.000Z'; // 09:00 EDT
    const to = '2026-09-08T15:00:00.000Z'; // 11:00 EDT
    const slots = computeAvailableSlots(TEST_POLICY, [], { from, to }, 'consultation');

    // De 09:00 a 11:00 con duración 60m caben 2 slots
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({
      start: '2026-09-08T13:00:00.000Z',
      end: '2026-09-08T14:00:00.000Z',
    });
    expect(slots[1]).toEqual({
      start: '2026-09-08T14:00:00.000Z',
      end: '2026-09-08T15:00:00.000Z',
    });
  });
});
