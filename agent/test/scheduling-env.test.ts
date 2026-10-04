import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseAppointmentTypes, parseBusinessHours } from '../src/config/scheduling-env';

/**
 * Regresión del fallo de despliegue: un valor JSON con las comillas perdidas por
 * el panel de despliegue tumbaba el arranque del servicio (crash-loop). Estas
 * variables son solo semilla, así que un valor inválido debe degradarse con aviso.
 */
describe('parseBusinessHours', () => {
  afterEach(() => vi.restoreAllMocks());

  it('acepta el formato compacto sin comillas', () => {
    const hours = parseBusinessHours('mon=09:00-18:00,tue=09:00-18:00,sat=closed,sun=-');

    expect(hours).toEqual({
      mon: { open: '09:00', close: '18:00' },
      tue: { open: '09:00', close: '18:00' },
      sat: null,
      sun: null,
    });
  });

  it('acepta horas de un dígito y espacios', () => {
    const hours = parseBusinessHours(' mon = 8:00 - 17:30 ');
    expect(hours?.mon).toEqual({ open: '8:00', close: '17:30' });
  });

  it('sigue aceptando JSON válido (compatibilidad)', () => {
    const hours = parseBusinessHours('{"mon":{"open":"10:00","close":"16:00"}}');
    expect(hours?.mon).toEqual({ open: '10:00', close: '16:00' });
    expect(hours?.sat).toBeUndefined();
  });

  it('NO lanza con JSON al que el panel le quitó las comillas', () => {
    // Este es exactamente el valor que provocaba el crash-loop en producción.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hours = parseBusinessHours('{mon:{open:09:00,close:18:00}}');

    expect(hours).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SCHEDULING_BUSINESS_HOURS'));
  });

  it('avisa y devuelve undefined ante un día o formato desconocido', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseBusinessHours('lunes=09:00-18:00')).toBeUndefined();
    expect(parseBusinessHours('mon=por-la-mañana')).toBeUndefined();
    expect(parseBusinessHours('mon')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('devuelve undefined si está vacía o ausente', () => {
    expect(parseBusinessHours(undefined)).toBeUndefined();
    expect(parseBusinessHours('   ')).toBeUndefined();
    expect(parseBusinessHours('')).toBeUndefined();
  });
});

describe('parseAppointmentTypes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('acepta el formato compacto con nombre opcional', () => {
    const types = parseAppointmentTypes('general=30:Reunión General,consultation=45,demo=30:Demo');

    expect(types).toEqual({
      general: { name: 'Reunión General', durationMinutes: 30, maxConcurrent: 1 },
      consultation: { durationMinutes: 45, maxConcurrent: 1 },
      demo: { name: 'Demo', durationMinutes: 30, maxConcurrent: 1 },
    });
  });

  it('sigue aceptando JSON válido (compatibilidad)', () => {
    const types = parseAppointmentTypes(
      '{"demo":{"name":"Demo","durationMinutes":20,"maxConcurrent":2}}',
    );
    expect(types?.demo).toEqual({ name: 'Demo', durationMinutes: 20, maxConcurrent: 2 });
  });

  it('NO lanza con JSON sin comillas', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const types = parseAppointmentTypes('{general:{durationMinutes:30}}');

    expect(types).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SCHEDULING_APPOINTMENT_TYPES'));
  });

  it('rechaza duraciones inválidas sin lanzar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(parseAppointmentTypes('general=0')).toBeUndefined();
    expect(parseAppointmentTypes('general=abc')).toBeUndefined();
    expect(parseAppointmentTypes('general')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('devuelve undefined si está vacía', () => {
    expect(parseAppointmentTypes(undefined)).toBeUndefined();
    expect(parseAppointmentTypes('  ')).toBeUndefined();
  });
});

describe('el arranque no depende de estas variables', () => {
  it('un valor inválido no impide cargar el módulo de entorno', async () => {
    // El módulo de env se importa con valores rotos en el proceso: si el esquema
    // volviera a ser estricto con JSON, este import haría process.exit(1).
    const original = {
      hours: process.env.SCHEDULING_BUSINESS_HOURS,
      types: process.env.SCHEDULING_APPOINTMENT_TYPES,
    };
    process.env.SCHEDULING_BUSINESS_HOURS = '{mon:{open:09:00}}';
    process.env.SCHEDULING_APPOINTMENT_TYPES = '{general:{durationMinutes:30}}';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { env } = await import('../src/config/env');
      // Se degrada a undefined en lugar de abortar.
      expect(env.SCHEDULING_BUSINESS_HOURS).toBeUndefined();
      expect(env.SCHEDULING_APPOINTMENT_TYPES).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      if (original.hours === undefined) delete process.env.SCHEDULING_BUSINESS_HOURS;
      else process.env.SCHEDULING_BUSINESS_HOURS = original.hours;
      if (original.types === undefined) delete process.env.SCHEDULING_APPOINTMENT_TYPES;
      else process.env.SCHEDULING_APPOINTMENT_TYPES = original.types;
      warn.mockRestore();
    }
  });
});
