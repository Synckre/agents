import {
  DayHours,
  SchedulingPolicy,
  WeekdayKey,
} from '@core/domain/scheduling-policy';
import {
  IAppointmentRepository,
  IBookedAppointmentRecord,
  ICreateAppointmentRecord,
} from '@core/ports/appointment-repository.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { DEFAULT_SCHEDULING_POLICY } from '@config/scheduling-policy';

export interface ErpNextSchedulingConfig {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiSecret?: string;
  readonly policyCacheTtlMs?: number;
  readonly defaultTimezone?: string;
}

interface ErpNextSlotAvailabilityRow {
  day_of_week?: string;
  from_time?: string;
  to_time?: string;
}

interface ErpNextHolidayRow {
  holiday_date?: string;
  description?: string;
}

interface ErpNextAppointmentDoc {
  name?: string;
  scheduled_time?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone_number?: string;
  status?: string;
  appointment_with?: string;
  party?: string;
  lead?: string;
  [key: string]: unknown;
}

const ERPNEXT_DAY_MAP: Record<string, WeekdayKey> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
};

function formatErpNextTime(raw?: string): string {
  if (!raw) return '09:00';
  const match = raw.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : '09:00';
}

function formatToErpNextDateTime(isoOrDate: string | Date): string {
  const d = new Date(isoOrDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Adaptador de agendamiento sobre los DocTypes nativos de ERPNext:
 * - Appointment Booking Settings & Holiday List (política de horarios y festivos)
 * - Appointment (persistencia y estado de citas)
 */
export class ErpNextSchedulingAdapter implements ISchedulingPolicyProvider, IAppointmentRepository {
  private cachedPolicy: SchedulingPolicy | null = null;
  private cacheExpiresAt = 0;
  private readonly cacheTtlMs: number;

  constructor(private readonly config: ErpNextSchedulingConfig) {
    this.cacheTtlMs = config.policyCacheTtlMs ?? 10 * 60 * 1000; // 10 minutos por defecto
  }

  // ==========================================
  // ISchedulingPolicyProvider
  // ==========================================

  async getPolicy(): Promise<SchedulingPolicy> {
    const now = Date.now();
    if (this.cachedPolicy && now < this.cacheExpiresAt) {
      return this.cachedPolicy;
    }

    if (!this.isConfigured()) {
      return DEFAULT_SCHEDULING_POLICY;
    }

    try {
      const policy = await this.fetchPolicyFromErpNext();
      this.cachedPolicy = policy;
      this.cacheExpiresAt = now + this.cacheTtlMs;
      return policy;
    } catch (error) {
      console.warn(
        '[ErpNextSchedulingAdapter] Could not load policy from ERPNext, using default fallback:',
        error instanceof Error ? error.message : error,
      );
      return DEFAULT_SCHEDULING_POLICY;
    }
  }

  /**
   * Invalida la caché local para forzar una recarga en la siguiente consulta.
   */
  invalidateCache(): void {
    this.cachedPolicy = null;
    this.cacheExpiresAt = 0;
  }

  private async fetchPolicyFromErpNext(): Promise<SchedulingPolicy> {
    const settingsRes = await this.request(
      '/api/resource/Appointment Booking Settings/Appointment Booking Settings',
    );
    if (!settingsRes.ok) {
      throw new Error(`Failed to fetch Appointment Booking Settings (${settingsRes.status})`);
    }

    const settingsData = ((await settingsRes.json()) as { data?: Record<string, unknown> }).data ?? {};
    const duration = Number(settingsData.appointment_duration) || 30;
    const holidayListName = typeof settingsData.holiday_list === 'string' ? settingsData.holiday_list : undefined;
    const availabilityRows = Array.isArray(settingsData.availability_of_slots)
      ? (settingsData.availability_of_slots as ErpNextSlotAvailabilityRow[])
      : [];

    // Mapear horarios por día de la semana
    const hoursByWeekday: Record<WeekdayKey, DayHours | null> = {
      mon: null,
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: null,
      sun: null,
    };

    if (availabilityRows.length > 0) {
      for (const row of availabilityRows) {
        if (!row.day_of_week) continue;
        const key = ERPNEXT_DAY_MAP[row.day_of_week.toLowerCase().trim()];
        if (key) {
          hoursByWeekday[key] = {
            open: formatErpNextTime(row.from_time),
            close: formatErpNextTime(row.to_time),
          };
        }
      }
    } else {
      // Fallback a los días laborales estándar de DEFAULT_SCHEDULING_POLICY
      Object.assign(hoursByWeekday, DEFAULT_SCHEDULING_POLICY.hoursByWeekday);
    }

    // Cargar festivos desde Holiday List si está configurado
    let holidays: string[] = [...DEFAULT_SCHEDULING_POLICY.holidays];
    if (holidayListName) {
      try {
        const holidayRes = await this.request(
          `/api/resource/Holiday List/${encodeURIComponent(holidayListName)}`,
        );
        if (holidayRes.ok) {
          const holidayData = ((await holidayRes.json()) as { data?: { holidays?: ErpNextHolidayRow[] } }).data;
          const rows = Array.isArray(holidayData?.holidays) ? holidayData.holidays : [];
          const fetchedHolidays = rows
            .map((r) => r.holiday_date)
            .filter((d): d is string => typeof d === 'string' && d.length > 0);
          if (fetchedHolidays.length > 0) {
            holidays = fetchedHolidays;
          }
        }
      } catch (err) {
        console.warn(`[ErpNextSchedulingAdapter] Could not load holiday list "${holidayListName}":`, err);
      }
    }

    return {
      timezone: this.config.defaultTimezone || DEFAULT_SCHEDULING_POLICY.timezone,
      hoursByWeekday,
      holidays,
      appointmentTypes: {
        ...DEFAULT_SCHEDULING_POLICY.appointmentTypes,
        general: {
          id: 'general',
          name: 'General',
          durationMinutes: duration,
          maxConcurrent: 1,
        },
      },
      maxAppointmentsPerDay: DEFAULT_SCHEDULING_POLICY.maxAppointmentsPerDay,
      slotIntervalMinutes: duration,
    };
  }

  // ==========================================
  // IAppointmentRepository
  // ==========================================

  async findAppointments(from: Date | string, to: Date | string): Promise<IBookedAppointmentRecord[]> {
    if (!this.isConfigured()) {
      return [];
    }

    const fromStr = formatToErpNextDateTime(from);
    const toStr = formatToErpNextDateTime(to);

    const filters = JSON.stringify([
      ['scheduled_time', 'between', [fromStr, toStr]],
      ['status', '!=', 'Cancelled'],
    ]);

    const fields = JSON.stringify([
      'name',
      'scheduled_time',
      'customer_name',
      'customer_email',
      'customer_phone_number',
      'status',
      'lead',
    ]);

    const url = `/api/resource/Appointment?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit_page_length=100`;
    const res = await this.request(url);
    if (!res.ok) {
      console.warn(`[ErpNextSchedulingAdapter] findAppointments failed (${res.status}): ${await res.text()}`);
      return [];
    }

    const payload = (await res.json()) as { data?: ErpNextAppointmentDoc[] };
    const items = Array.isArray(payload.data) ? payload.data : [];

    return items.map((doc) => ({
      id: String(doc.name ?? ''),
      scheduledTime: String(doc.scheduled_time ?? ''),
      customerName: String(doc.customer_name ?? ''),
      email: doc.customer_email,
      phone: doc.customer_phone_number,
      status: String(doc.status ?? 'Scheduled'),
      leadId: doc.lead,
      raw: doc,
    }));
  }

  async createAppointment(input: ICreateAppointmentRecord): Promise<IBookedAppointmentRecord> {
    this.assertConfigured();

    const body: Record<string, unknown> = {
      scheduled_time: formatToErpNextDateTime(input.scheduledTime),
      customer_name: input.customerName,
      status: 'Scheduled',
    };

    if (input.email) {
      body.customer_email = input.email;
    }
    if (input.phone) {
      body.customer_phone_number = input.phone;
    }
    if (input.leadId) {
      body.appointment_with = 'Lead';
      body.party = input.leadId;
      body.lead = input.leadId;
    }

    const res = await this.request('/api/resource/Appointment', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`ERPNext createAppointment error (${res.status}): ${await res.text()}`);
    }

    const payload = (await res.json()) as { data?: ErpNextAppointmentDoc };
    const doc = payload.data;
    if (!doc || !doc.name) {
      throw new Error('ERPNext createAppointment returned an invalid document');
    }

    return {
      id: String(doc.name),
      scheduledTime: String(doc.scheduled_time ?? input.scheduledTime),
      customerName: String(doc.customer_name ?? input.customerName),
      email: doc.customer_email,
      phone: doc.customer_phone_number,
      status: String(doc.status ?? 'Scheduled'),
      leadId: doc.lead,
      raw: doc,
    };
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    this.assertConfigured();
    const res = await this.request(`/api/resource/Appointment/${encodeURIComponent(appointmentId)}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'Cancelled' }),
    });

    if (!res.ok) {
      throw new Error(`ERPNext cancelAppointment error (${res.status}): ${await res.text()}`);
    }
  }

  async rescheduleAppointment(
    appointmentId: string,
    newScheduledTime: string,
  ): Promise<IBookedAppointmentRecord> {
    this.assertConfigured();
    const res = await this.request(`/api/resource/Appointment/${encodeURIComponent(appointmentId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        scheduled_time: formatToErpNextDateTime(newScheduledTime),
        status: 'Scheduled',
      }),
    });

    if (!res.ok) {
      throw new Error(`ERPNext rescheduleAppointment error (${res.status}): ${await res.text()}`);
    }

    const payload = (await res.json()) as { data?: ErpNextAppointmentDoc };
    const doc = payload.data;

    return {
      id: String(doc?.name ?? appointmentId),
      scheduledTime: String(doc?.scheduled_time ?? newScheduledTime),
      customerName: String(doc?.customer_name ?? ''),
      email: doc?.customer_email,
      phone: doc?.customer_phone_number,
      status: String(doc?.status ?? 'Scheduled'),
      leadId: doc?.lead,
      raw: doc,
    };
  }

  // ==========================================
  // HTTP Helpers
  // ==========================================

  private isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.apiKey && this.config.apiSecret);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error('ERPNext scheduling client is not configured (baseUrl/apiKey/apiSecret missing)');
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const encodedPath = encodeURI(path);
    const url = `${this.config.baseUrl?.replace(/\/$/, '')}${encodedPath}`;
    const headers = new Headers(init.headers);
    headers.set('Authorization', `token ${this.config.apiKey}:${this.config.apiSecret}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(url, { ...init, headers });
  }
}
