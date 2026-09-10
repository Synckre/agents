import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErpNextSchedulingAdapter } from '../src/adapters/crm/erpnext-scheduling.adapter';
import { DEFAULT_SCHEDULING_POLICY } from '../src/config/scheduling-policy';

describe('ErpNextSchedulingAdapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retorna DEFAULT_SCHEDULING_POLICY si no está configurado', async () => {
    const adapter = new ErpNextSchedulingAdapter({});
    const policy = await adapter.getPolicy();
    expect(policy.timezone).toBe(DEFAULT_SCHEDULING_POLICY.timezone);
    expect(policy.maxAppointmentsPerDay).toBe(DEFAULT_SCHEDULING_POLICY.maxAppointmentsPerDay);
  });

  it('obtiene y mapea la política desde Appointment Booking Settings y Holiday List en ERPNext', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('Appointment%20Booking%20Settings')) {
        return new Response(
          JSON.stringify({
            data: {
              appointment_duration: 45,
              holiday_list: 'Holidays-2026',
              availability_of_slots: [
                { day_of_week: 'Monday', from_time: '10:00:00', to_time: '17:00:00' },
                { day_of_week: 'Tuesday', from_time: '10:00:00', to_time: '17:00:00' },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('Holiday%20List')) {
        return new Response(
          JSON.stringify({
            data: {
              holidays: [
                { holiday_date: '2026-09-07', description: 'Labor Day' },
                { holiday_date: '2026-12-25', description: 'Christmas' },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ErpNextSchedulingAdapter({
      baseUrl: 'http://erpnext.local',
      apiKey: 'k',
      apiSecret: 's',
      policyCacheTtlMs: 5000,
    });

    const policy = await adapter.getPolicy();
    expect(policy.appointmentTypes.general?.durationMinutes).toBe(45);
    expect(policy.hoursByWeekday.mon).toEqual({ open: '10:00', close: '17:00' });
    expect(policy.hoursByWeekday.wed).toBeNull(); // Wednesday not in availability rows
    expect(policy.holidays).toContain('2026-09-07');
    expect(policy.holidays).toContain('2026-12-25');

    // Comprobar caché TTL: una segunda llamada no debe disparar fetch adicional
    await adapter.getPolicy();
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 for Settings, 1 for Holiday List
  });

  it('crea un DocType Appointment en ERPNext vinculado al Lead', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.lead).toBe('CRM-LEAD-001');
      expect(body.status).toBe('Scheduled');

      return new Response(
        JSON.stringify({
          data: {
            name: 'APPT-2026-0001',
            scheduled_time: '2026-09-08 14:00:00',
            customer_name: 'Ana Gomez',
            customer_email: 'ana@example.com',
            lead: 'CRM-LEAD-001',
            status: 'Scheduled',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ErpNextSchedulingAdapter({
      baseUrl: 'http://erpnext.local',
      apiKey: 'k',
      apiSecret: 's',
    });

    const created = await adapter.createAppointment({
      customerName: 'Ana Gomez',
      scheduledTime: '2026-09-08T14:00:00.000Z',
      email: 'ana@example.com',
      leadId: 'CRM-LEAD-001',
    });

    expect(created.id).toBe('APPT-2026-0001');
    expect(created.leadId).toBe('CRM-LEAD-001');
  });

  it('cancela un Appointment en ERPNext', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(init?.body as string);
      expect(body.status).toBe('Cancelled');
      return new Response(JSON.stringify({ data: { name: 'APPT-2026-0001', status: 'Cancelled' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const adapter = new ErpNextSchedulingAdapter({
      baseUrl: 'http://erpnext.local',
      apiKey: 'k',
      apiSecret: 's',
    });

    await expect(adapter.cancelAppointment('APPT-2026-0001')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
