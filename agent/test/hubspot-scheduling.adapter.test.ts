import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPOINTMENT_STATUS,
  CUSTOM_APPOINTMENT_PROPERTIES,
  HubspotSchedulingAdapter,
  isCanceledStatus,
} from '../src/adapters/crm/hubspot/hubspot-scheduling.adapter';
import { HubspotHttpClient } from '../src/adapters/crm/hubspot/hubspot-http.client';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RecordedCall {
  url: string;
  path: string;
  method: string;
  body: Record<string, any> | undefined;
}

/**
 * Los tests escriben los mocks en función de método + ruta, no del orden de
 * llamada: la resolución de id de cita añade lecturas previas y los índices
 * posicionales hacían los tests frágiles y falsos.
 */
function buildAdapter(config: { appointmentObjectType?: string } = {}) {
  const calls: RecordedCall[] = [];
  const routes: Array<{
    method: string;
    match: (path: string) => boolean;
    response: (call: RecordedCall) => Response;
  }> = [];

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const full = String(url);
    const path = full.replace('https://api.hubapi.com', '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: RecordedCall = {
      url: full,
      path,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);

    const route = routes.find((r) => r.method === method && r.match(path));
    if (!route) {
      throw new Error(`Sin ruta simulada para ${method} ${path}`);
    }
    return route.response(call);
  });

  const client = new HubspotHttpClient({
    baseUrl: 'https://api.hubapi.com',
    apiVersion: '2026-09',
    accessToken: 'test-token',
    maxRetries: 0,
    sleep: async () => undefined,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  const adapter = new HubspotSchedulingAdapter({ client, ...config });
  return { adapter, fetchImpl, calls, routes };
}

function findCalls(calls: RecordedCall[], method: string, pathIncludes: string): RecordedCall[] {
  return calls.filter((c) => c.method === method && c.path.includes(pathIncludes));
}

const NATIVE_RECORD = {
  id: 'appt-1',
  properties: {
    hs_appointment_name: 'Synckre Appointment — Ana',
    hs_appointment_start: '2026-11-10T15:00:00.000Z',
    hs_appointment_end: '2026-11-10T15:30:00.000Z',
    synckre_status: APPOINTMENT_STATUS.scheduled,
    synckre_customer_name: 'Ana',
    synckre_customer_email: 'ana@example.com',
    synckre_calendar_event_id: 'gcal-123',
  },
};

describe('HubspotSchedulingAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('objeto nativo appointments', () => {
    it('busca citas con BETWEEN sobre hs_appointment_start y epoch en ms', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [NATIVE_RECORD] }),
      });

      const from = new Date('2026-11-10T00:00:00.000Z');
      const to = new Date('2026-11-11T00:00:00.000Z');
      const appointments = await adapter.findAppointments(from, to);

      const call = findCalls(calls, 'POST', '/appointments/search')[0];
      const filter = call.body!.filterGroups[0].filters[0];
      expect(filter.propertyName).toBe('hs_appointment_start');
      expect(filter.operator).toBe('BETWEEN');
      expect(filter.highValue).toBe(String(to.getTime()));
      // La ventana arranca antes del `from` pedido, para captar citas que solapan.
      expect(Number(filter.value)).toBeLessThan(from.getTime());

      expect(appointments).toHaveLength(1);
      expect(appointments[0]).toMatchObject({
        id: 'appt-1',
        scheduledTime: '2026-11-10T15:00:00.000Z',
        customerName: 'Ana',
        email: 'ana@example.com',
        status: APPOINTMENT_STATUS.scheduled,
        calendarEventId: 'gcal-123',
      });
    });

    it('incluye una cita que empieza antes de la ventana pero solapa con ella', async () => {
      const { adapter, routes } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () =>
          json({
            results: [
              {
                id: 'appt-overlap',
                properties: {
                  hs_appointment_start: '2026-11-10T09:30:00.000Z',
                  hs_appointment_end: '2026-11-10T10:30:00.000Z',
                },
              },
            ],
          }),
      });

      // La ventana empieza a las 10:00: la cita empezó antes pero sigue en curso.
      const appointments = await adapter.findAppointments(
        new Date('2026-11-10T10:00:00.000Z'),
        new Date('2026-11-10T12:00:00.000Z'),
      );

      expect(appointments.map((a) => a.id)).toEqual(['appt-overlap']);
    });

    it('excluye una cita que termina justo antes de la ventana', async () => {
      const { adapter, routes } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () =>
          json({
            results: [
              {
                id: 'appt-past',
                properties: {
                  hs_appointment_start: '2026-11-10T08:00:00.000Z',
                  hs_appointment_end: '2026-11-10T09:00:00.000Z',
                },
              },
            ],
          }),
      });

      const appointments = await adapter.findAppointments(
        new Date('2026-11-10T10:00:00.000Z'),
        new Date('2026-11-10T12:00:00.000Z'),
      );

      expect(appointments).toHaveLength(0);
    });

    it('recorre la paginación en lugar de truncar el resultado', async () => {
      const { adapter, routes } = buildAdapter();
      let page = 0;
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => {
          page += 1;
          if (page === 1) {
            return json({
              results: [
                { id: 'a1', properties: { hs_appointment_start: '2026-11-10T15:00:00.000Z', hs_appointment_end: '2026-11-10T15:30:00.000Z' } },
              ],
              paging: { next: { after: 'cursor-1' } },
            });
          }
          return json({
            results: [
              { id: 'a2', properties: { hs_appointment_start: '2026-11-10T16:00:00.000Z', hs_appointment_end: '2026-11-10T16:30:00.000Z' } },
            ],
          });
        },
      });

      const appointments = await adapter.findAppointments(
        new Date('2026-11-10T00:00:00.000Z'),
        new Date('2026-11-11T00:00:00.000Z'),
      );

      expect(appointments.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
      expect(page).toBe(2);
    });

    it('excluye las citas canceladas, aceptando los dos deletreos', async () => {
      const { adapter, routes } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () =>
          json({
            results: [
              NATIVE_RECORD,
              {
                id: 'appt-2',
                properties: { ...NATIVE_RECORD.properties, synckre_status: 'CANCELED' },
              },
              {
                id: 'appt-3',
                // Deletreo alternativo: también debe considerarse cancelada.
                properties: { ...NATIVE_RECORD.properties, synckre_status: 'CANCELLED' },
              },
            ],
          }),
      });

      const appointments = await adapter.findAppointments(
        new Date('2026-11-10T00:00:00.000Z'),
        new Date('2026-11-11T00:00:00.000Z'),
      );

      expect(appointments.map((a) => a.id)).toEqual(['appt-1']);
    });

    it('crea la cita con las propiedades nativas y la asocia al contacto', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [] }),
      });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments'),
        response: () => json({ id: 'appt-9', properties: {} }, 201),
      });

      await adapter.createAppointment({
        scheduledTime: '2026-11-10T15:00:00.000Z',
        customerName: 'Ana',
        email: 'ana@example.com',
        leadId: '501',
        calendarEventId: 'gcal-123',
        appointmentType: 'general',
        durationMinutes: 45,
      });

      const create = findCalls(calls, 'POST', '/appointments').find((c) => !c.path.endsWith('/search'))!;
      expect(create.body!.properties.hs_appointment_name).toContain('Ana');
      expect(create.body!.properties.hs_appointment_start).toBe('2026-11-10T15:00:00.000Z');
      expect(create.body!.properties.hs_appointment_end).toBe('2026-11-10T15:45:00.000Z');
      expect(create.body!.properties.synckre_status).toBe(APPOINTMENT_STATUS.scheduled);
      expect(create.body!.properties.synckre_calendar_event_id).toBe('gcal-123');
      expect(create.body!.associations[0].to.id).toBe('501');
      expect(create.body!.associations[0].types[0].associationTypeId).toBe(906);
    });

    it('no duplica la cita si ya existe el registro de ese evento de calendario', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [NATIVE_RECORD] }),
      });

      const result = await adapter.createAppointment({
        scheduledTime: '2026-11-10T15:00:00.000Z',
        customerName: 'Ana',
        calendarEventId: 'gcal-123',
      });

      // Se reutiliza el registro existente en lugar de crear otro.
      expect(result.id).toBe('appt-1');
      expect(findCalls(calls, 'POST', '/appointments').some((c) => !c.path.endsWith('/search'))).toBe(false);
    });

    it('usa 30 minutos por defecto si no se indica duración', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [] }),
      });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments'),
        response: () => json({ id: 'appt-9', properties: {} }, 201),
      });

      await adapter.createAppointment({
        scheduledTime: '2026-11-10T15:00:00.000Z',
        customerName: 'Ana',
      });

      const create = findCalls(calls, 'POST', '/appointments').find((c) => !c.path.endsWith('/search'))!;
      expect(create.body!.properties.hs_appointment_end).toBe('2026-11-10T15:30:00.000Z');
    });

    it('cancela la cita real de HubSpot aunque llegue el id del evento de Google', async () => {
      const { adapter, routes, calls } = buildAdapter();
      // 1) GET por id directo: no existe (el id es de Google Calendar).
      routes.push({
        method: 'GET',
        match: (p) => p.includes('/appointments/gcal-google-id'),
        response: () => json({ message: 'not found' }, 404),
      });
      // 2) Búsqueda por identidad externa: encuentra el registro espejo.
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [NATIVE_RECORD] }),
      });
      // 3) PATCH sobre el id REAL de HubSpot.
      routes.push({
        method: 'PATCH',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => json({ id: 'appt-1', properties: {} }),
      });

      await adapter.cancelAppointment('gcal-google-id');

      const patch = findCalls(calls, 'PATCH', '/appointments')[0];
      expect(patch.path).toContain('/appointments/appt-1');
      expect(patch.path).not.toContain('gcal-google-id');
      expect(patch.body!.properties.synckre_status).toBe(APPOINTMENT_STATUS.canceled);
    });

    it('falla de forma explícita si la cita no existe en el CRM (no un falso éxito)', async () => {
      const { adapter, routes } = buildAdapter();
      routes.push({
        method: 'GET',
        match: (p) => p.includes('/appointments/desconocido'),
        response: () => json({ message: 'not found' }, 404),
      });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [] }),
      });

      await expect(adapter.cancelAppointment('desconocido')).rejects.toMatchObject({
        code: 'CRM_NOT_FOUND',
      });
    });

    it('conserva los datos del cliente al reprogramar', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'GET',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => json(NATIVE_RECORD),
      });
      routes.push({
        method: 'PATCH',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () =>
          json({ id: 'appt-1', properties: { hs_appointment_start: '2026-11-12T09:00:00.000Z' } }),
      });

      const updated = await adapter.rescheduleAppointment('appt-1', '2026-11-12T09:00:00.000Z');

      const patch = findCalls(calls, 'PATCH', '/appointments')[0];
      expect(patch.body!.properties.hs_appointment_start).toBe('2026-11-12T09:00:00.000Z');
      // 30 minutos originales, no el valor por defecto ni uno recalculado.
      expect(patch.body!.properties.hs_appointment_end).toBe('2026-11-12T09:30:00.000Z');
      // El registro devuelto sigue siendo completo tras un PATCH parcial.
      expect(updated.id).toBe('appt-1');
      expect(updated.customerName).toBe('Ana');
      expect(updated.email).toBe('ana@example.com');
      expect(updated.calendarEventId).toBe('gcal-123');
    });

    it('escribe las fechas en ISO-8601, no como epoch en cadena', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [] }),
      });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments'),
        response: () => json({ id: 'appt-9', properties: {} }, 201),
      });

      await adapter.createAppointment({
        scheduledTime: '2027-03-15T18:00:00.000Z',
        customerName: 'Ana',
        durationMinutes: 30,
      });

      const create = findCalls(calls, 'POST', '/appointments').find((c) => !c.path.endsWith('/search'))!;
      // Un epoch en cadena no es interpretable por `new Date(...)`: si se
      // escribiera así, al releer la cita el solapamiento daría Invalid Date.
      expect(create.body!.properties.hs_appointment_start).toBe('2027-03-15T18:00:00.000Z');
      expect(create.body!.properties.hs_appointment_end).toBe('2027-03-15T18:30:00.000Z');
      expect(new Date(create.body!.properties.hs_appointment_start).getTime()).not.toBeNaN();
    });

    it('interpreta una fecha guardada como epoch (tolerancia al formato)', async () => {
      const { adapter, routes } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () =>
          json({
            results: [
              {
                id: 'appt-epoch',
                properties: {
                  // Epoch en milisegundos, como cadena.
                  hs_appointment_start: String(new Date('2027-03-15T18:00:00.000Z').getTime()),
                  hs_appointment_end: String(new Date('2027-03-15T18:30:00.000Z').getTime()),
                },
              },
            ],
          }),
      });

      const busy = await adapter.findAppointments(
        new Date('2027-03-15T00:00:00Z'),
        new Date('2027-03-16T12:00:00Z'),
      );

      // Debe reconocer el solape en lugar de descartar la cita por fecha inválida.
      expect(busy.map((b) => b.id)).toEqual(['appt-epoch']);
    });

    it('marca el estado si la propiedad existe', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'GET',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => json(NATIVE_RECORD),
      });
      routes.push({
        method: 'PATCH',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => json({ id: 'appt-1', properties: {} }),
      });

      await adapter.cancelAppointment('appt-1');

      expect(findCalls(calls, 'PATCH', '/appointments')).toHaveLength(1);
      expect(findCalls(calls, 'DELETE', '/appointments')).toHaveLength(0);
    });

    it('archiva la cita si el portal no admite la propiedad de estado', async () => {
      // Portal sin propiedades personalizadas: no hay dónde guardar el estado.
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'GET',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => json(NATIVE_RECORD),
      });
      routes.push({
        method: 'PATCH',
        match: (p) => p.includes('/appointments/appt-1'),
        // Sin propiedades que actualizar, como responde HubSpot.
        response: () =>
          json(
            {
              status: 'error',
              category: 'VALIDATION_ERROR',
              message: 'No properties found to update, please provide at least one.',
            },
            400,
          ),
      });
      routes.push({
        method: 'DELETE',
        match: (p) => p.includes('/appointments/appt-1'),
        response: () => new Response(null, { status: 204 }),
      });

      // La cancelación no debe fallar: se degrada a archivado.
      await expect(adapter.cancelAppointment('appt-1')).resolves.toBeUndefined();

      const del = findCalls(calls, 'DELETE', '/appointments');
      expect(del).toHaveLength(1);
      expect(del[0].path).toContain('/appointments/appt-1');
    });

    it('rechaza fechas inválidas con un error de validación de CRM', async () => {
      const { adapter, fetchImpl } = buildAdapter();

      await expect(
        adapter.createAppointment({ scheduledTime: 'no-es-fecha', customerName: 'Ana' }),
      ).rejects.toMatchObject({ code: 'CRM_VALIDATION_ERROR' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('objeto personalizado', () => {
    it('usa las propiedades synckre_* cuando se configura un objectTypeId', async () => {
      const { adapter, routes, calls } = buildAdapter({ appointmentObjectType: '2-12345678' });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/2-12345678/search'),
        response: () => json({ results: [] }),
      });

      await adapter.findAppointments(
        new Date('2026-11-01T00:00:00.000Z'),
        new Date('2026-11-30T00:00:00.000Z'),
      );

      const call = findCalls(calls, 'POST', '/2-12345678/search')[0];
      expect(call.body!.filterGroups[0].filters[0].propertyName).toBe(
        CUSTOM_APPOINTMENT_PROPERTIES.start,
      );
    });

    it('prescinde de las propiedades personalizadas si el objeto no las admite', async () => {
      const { adapter, routes, calls } = buildAdapter();
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments/search'),
        response: () => json({ results: [] }),
      });
      routes.push({
        method: 'POST',
        match: (p) => p.endsWith('/appointments'),
        response: (call) => {
          const props = call.body!.properties as Record<string, string>;
          const hasCustom = Object.values(CUSTOM_APPOINTMENT_PROPERTIES).some((k) => k in props);
          return hasCustom
            ? json({ status: 'error', category: 'VALIDATION_ERROR', message: 'invalid property' }, 400)
            : json({ id: 'appt-9', properties: {} }, 201);
        },
      });

      const created = await adapter.createAppointment({
        scheduledTime: '2026-11-10T15:00:00.000Z',
        customerName: 'Ana',
        leadId: '501',
        durationMinutes: 30,
      });

      expect(created.id).toBe('appt-9');
      const creates = findCalls(calls, 'POST', '/appointments').filter((c) => !c.path.endsWith('/search'));
      expect(creates).toHaveLength(2);
      const retryProps = creates[1].body!.properties as Record<string, string>;
      expect(retryProps.hs_appointment_start).toBe('2026-11-10T15:00:00.000Z');
      for (const key of Object.values(CUSTOM_APPOINTMENT_PROPERTIES)) {
        expect(retryProps[key]).toBeUndefined();
      }
      expect(creates[1].body!.associations[0].to.id).toBe('501');
    });
  });
});

describe('isCanceledStatus', () => {
  it('acepta ambos deletreos y es insensible a mayúsculas', () => {
    expect(isCanceledStatus('CANCELED')).toBe(true);
    expect(isCanceledStatus('CANCELLED')).toBe(true);
    expect(isCanceledStatus('canceled')).toBe(true);
    expect(isCanceledStatus('SCHEDULED')).toBe(false);
    expect(isCanceledStatus(undefined)).toBe(false);
    expect(isCanceledStatus('')).toBe(false);
  });
});
