import { describe, expect, it } from 'vitest';
import {
  renderSchedulingPolicyContext,
  renderSchedulingPolicyFaq,
} from '../src/core/domain/scheduling-policy-description';
import { SchedulingPolicy } from '../src/core/domain/scheduling-policy';

function policy(overrides: Partial<SchedulingPolicy> = {}): SchedulingPolicy {
  return {
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
    holidays: ['2026-01-01', '2026-12-25'],
    appointmentTypes: {
      general: { id: 'general', name: 'Reunión General', durationMinutes: 30, maxConcurrent: 1 },
      consultation: { id: 'consultation', name: 'Consultoría', durationMinutes: 45, maxConcurrent: 1 },
    },
    maxAppointmentsPerDay: 8,
    slotIntervalMinutes: 30,
    ...overrides,
  };
}

const TODAY = new Date('2026-06-01T12:00:00Z');

describe('renderSchedulingPolicyFaq', () => {
  it('agrupa días consecutivos con el mismo horario', () => {
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY });

    // Cinco días idénticos se resumen en un rango, no en cinco líneas.
    expect(faq).toContain('lunes a viernes: 09:00-18:00');
    expect(faq).toContain('sábado a domingo: cerrado');
  });

  it('incluye duraciones, capacidad e intervalo', () => {
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY });

    expect(faq).toContain('Reunión General');
    expect(faq).toContain('30 minutos');
    expect(faq).toContain('Consultoría');
    expect(faq).toContain('45 minutos');
    expect(faq).toContain('8 reuniones por día');
    expect(faq).toContain('cada **30 minutos**');
    expect(faq).toContain('America/New_York');
  });

  it('sólo lista festivos que aún no han pasado', () => {
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY });

    // El festivo de enero ya pasó; el de diciembre no.
    expect(faq).not.toContain('2026-01-01');
    expect(faq).toContain('2026-12-25');
  });

  it('omite la lista de festivos si no queda ninguno', () => {
    const faq = renderSchedulingPolicyFaq(
      policy({ holidays: ['2020-01-01'] }),
      { today: TODAY },
    );

    expect(faq).not.toContain('festivos');
  });

  it('omite capacidad e intervalo si no están definidos', () => {
    const faq = renderSchedulingPolicyFaq(
      policy({ maxAppointmentsPerDay: undefined, slotIntervalMinutes: undefined }),
      { today: TODAY },
    );

    expect(faq).not.toContain('reuniones por día');
    expect(faq).not.toContain('huecos empiezan');
  });

  it('deja claro que la disponibilidad real se consulta aparte', () => {
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY });

    // Sin esto, el modelo podría prometer huecos basándose sólo en el horario.
    expect(faq).toMatch(/disponibilidad real/i);
  });

  it('genera la versión en inglés cuando se pide', () => {
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY, locale: 'en' });

    expect(faq).toContain('Business hours');
    expect(faq).toContain('Monday to Friday');
    expect(faq).toContain('minutes');
  });

  it('refleja un cambio de política (no es texto fijo)', () => {
    const faq = renderSchedulingPolicyFaq(
      policy({
        hoursByWeekday: {
          mon: { open: '10:00', close: '16:00' },
          tue: null,
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
        appointmentTypes: { demo: { id: 'demo', name: 'Demo', durationMinutes: 20, maxConcurrent: 1 } },
        maxAppointmentsPerDay: 3,
      }),
      { today: TODAY },
    );

    expect(faq).toContain('lunes: 10:00-16:00');
    expect(faq).toContain('Demo');
    expect(faq).toContain('20 minutos');
    expect(faq).toContain('3 reuniones por día');
    // Y ya no aparece el horario anterior.
    expect(faq).not.toContain('09:00-18:00');
  });
});

describe('renderSchedulingPolicyContext', () => {
  it('produce un bloque compacto con los datos exactos', () => {
    const context = renderSchedulingPolicyContext(policy(), TODAY);

    expect(context).toContain('POLÍTICA DE AGENDAMIENTO VIGENTE');
    expect(context).toContain('Zona horaria: America/New_York');
    expect(context).toContain('lunes a viernes: 09:00-18:00');
    expect(context).toContain('general');
    expect(context).toContain('Máximo de reuniones por día: 8');
  });

  it('prohíbe ofrecer huecos sin consultar la disponibilidad', () => {
    const context = renderSchedulingPolicyContext(policy(), TODAY);

    expect(context).toContain('check_availability');
    expect(context).toMatch(/única fuente válida/i);
  });

  it('indica explícitamente cuando no hay días cerrados', () => {
    const context = renderSchedulingPolicyContext(policy({ holidays: [] }), TODAY);

    expect(context).toContain('Sin días cerrados configurados');
  });

  it('es más corto que la sección de FAQ', () => {
    // El contexto viaja en cada turno: debe ser un resumen, no la explicación.
    const context = renderSchedulingPolicyContext(policy(), TODAY);
    const faq = renderSchedulingPolicyFaq(policy(), { today: TODAY });

    expect(context.length).toBeLessThan(faq.length);
  });
});
