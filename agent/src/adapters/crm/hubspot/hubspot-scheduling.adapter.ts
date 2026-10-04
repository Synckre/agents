import {
  IAppointmentRepository,
  IBookedAppointmentRecord,
  ICreateAppointmentRecord,
} from '@core/ports/appointment-repository.port';
import { CrmError } from '@core/ports/crm.port';
import { HubspotHttpClient } from './hubspot-http.client';
import { HubspotObjectRecord, HubspotSearchResponse } from './hubspot-mapping';

export interface HubspotSchedulingAdapterConfig {
  readonly client: HubspotHttpClient;
  /**
   * Objeto de citas: el nativo `appointments` o un objeto personalizado
   * (nombre, o su objectTypeId con formato `2-12345678`).
   */
  readonly appointmentObjectType?: string;
  /** Tipo de asociación cita -> contacto (nativo: 906). Se verifica en el bootstrap. */
  readonly appointmentContactAssociationTypeId?: number;
}

/** Tamaño de página del endpoint de búsqueda (el máximo permitido es 200). */
const SEARCH_PAGE_SIZE = 100;

/**
 * Margen de retroceso al consultar citas, para capturar las que empiezan antes de
 * la ventana y terminan dentro. Debe cubrir la cita más larga permitida.
 */
const MAX_APPOINTMENT_DURATION_MINUTES = 240;

/** Duración asumida si el registro no expone un fin válido. */
const DEFAULT_APPOINTMENT_MINUTES = 30;

const DATE_PROPERTY = 'hs_appointment_start';
const NAME_PROPERTY = 'hs_appointment_name';
const END_PROPERTY = 'hs_appointment_end';

/**
 * El objeto nativo de citas NO expone ninguna propiedad de estado.
 * Verificado contra el portal: sólo existen `hs_appointment_name`, `hs_appointment_start`
 * y `hs_appointment_end`. Escribir `hs_appointment_status` devuelve 400, así que el
 * estado se guarda en una propiedad propia.
 */
const NATIVE_STATUS_PROPERTY = 'synckre_status';

/** Objeto personalizado creado por el bootstrap, por si se opta por esa vía. */
export const CUSTOM_APPOINTMENT_PROPERTIES = {
  name: 'synckre_appointment_name',
  start: 'synckre_scheduled_time',
  end: 'synckre_scheduled_end',
  status: 'synckre_status',
  calendarEventId: 'synckre_calendar_event_id',
  externalId: 'synckre_external_id',
  customerName: 'synckre_customer_name',
  customerEmail: 'synckre_customer_email',
  customerPhone: 'synckre_customer_phone',
  notes: 'synckre_notes',
} as const;

/**
 * Estados de cita. El esquema de HubSpot no define `hs_appointment_status`, así
 * que el valor no está fijado por contrato. Se escribe `CANCELED` (el deletreo
 * dominante en la API) y al leer se aceptan tanto `CANCELED` como `CANCELLED`,
 * para no dar por ocupado un hueco que el CRM considera cancelado.
 */
export const APPOINTMENT_STATUS = {
  scheduled: 'SCHEDULED',
  canceled: 'CANCELED',
} as const;

/** ¿El valor de estado representa una cita cancelada? Acepta ambos deletreos. */
export function isCanceledStatus(value?: string | null): boolean {
  return /^CANCEL+ED$/i.test((value ?? '').trim());
}

/** Normaliza una fecha a la representación que espera una propiedad datetime de HubSpot. */
function toHubspotDateTime(value: string | Date): string {
  const parsed = value instanceof Date ? value : parseDatetime(String(value));
  if (!parsed) {
    throw new CrmError({
      code: 'CRM_VALIDATION_ERROR',
      message: `Invalid appointment datetime: "${String(value)}"`,
      retryable: false,
    });
  }
  // ISO-8601 explícito: es lo que HubSpot devuelve en las propiedades datetime,
  // y una cadena de epoch no sería interpretable al releer el registro.
  return parsed.toISOString();
}

/**
 * Interpreta el valor de una propiedad datetime de HubSpot.
 *
 * Acepta ISO-8601 y epoch en milisegundos (o segundos). Es necesario porque un
 * epoch en string NO es parseable por `new Date(...)`: si se colara, toda
 * comparación de solapamiento daría `Invalid Date` y la cita desaparecería del
 * cálculo de disponibilidad.
 */
function parseDatetime(raw?: string | null): Date | null {
  if (raw === undefined || raw === null) return null;
  const value = raw.trim();
  if (value.length === 0) return null;

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    // Un epoch en segundos tiene 10 dígitos; en milisegundos, 13.
    const ms = value.length <= 11 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Convierte una fecha a epoch en milisegundos, formato de los filtros de búsqueda. */
function toEpochMillis(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CrmError({
      code: 'CRM_VALIDATION_ERROR',
      message: `Invalid appointment datetime: "${String(value)}"`,
      retryable: false,
    });
  }
  return date.getTime();
}

function firstProperty(
  record: HubspotObjectRecord,
  ...names: string[]
): string | undefined {
  const props = record.properties ?? {};
  for (const name of names) {
    const value = props[name];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function asBookedAppointment(
  record: HubspotObjectRecord,
  statusProperty: string,
): IBookedAppointmentRecord {
  const start = firstProperty(record, DATE_PROPERTY, CUSTOM_APPOINTMENT_PROPERTIES.start) ?? '';
  return {
    id: String(record.id),
    scheduledTime: start,
    customerName:
      firstProperty(
        record,
        CUSTOM_APPOINTMENT_PROPERTIES.customerName,
        NAME_PROPERTY,
        CUSTOM_APPOINTMENT_PROPERTIES.name,
      ) ?? '',
    email: firstProperty(record, CUSTOM_APPOINTMENT_PROPERTIES.customerEmail),
    phone: firstProperty(record, CUSTOM_APPOINTMENT_PROPERTIES.customerPhone),
    status: firstProperty(record, statusProperty) ?? 'Scheduled',
    calendarEventId: firstProperty(record, CUSTOM_APPOINTMENT_PROPERTIES.calendarEventId),
    raw: record,
  };
}

/**
 * Repositorio de citas sobre el objeto de citas de HubSpot.
 *
 * Google Calendar sigue siendo la fuente de verdad del evento (con Meet link y
 * asistentes); este adaptador espeja la cita en HubSpot para reporting, dedupe
 * y cálculo de disponibilidad.
 */
export class HubspotSchedulingAdapter implements IAppointmentRepository {
  private readonly client: HubspotHttpClient;
  private readonly objectType: string;
  private readonly associationTypeId: number;
  /** Cachea si el portal usa el objeto nativo o un objeto personalizado. */
  private usesNativeObject: boolean;
  /** Propiedades reales del objeto (null = aún no sondeadas o no se pudo). */
  private propertyNames: Set<string> | null = null;

  constructor(config: HubspotSchedulingAdapterConfig) {
    this.client = config.client;
    this.objectType = config.appointmentObjectType?.trim() || 'appointments';
    this.associationTypeId = config.appointmentContactAssociationTypeId ?? 906;
    // Un objectTypeId con formato `2-123` denota un objeto personalizado.
    this.usesNativeObject = !/^\d+-\d+$/.test(this.objectType) && this.objectType === 'appointments';
  }

  async findAppointments(from: Date | string, to: Date | string): Promise<IBookedAppointmentRecord[]> {
    const fromMs = toEpochMillis(from);
    const toMs = toEpochMillis(to);

    // HubSpot no permite filtrar por "fin de la cita", así que se consulta desde
    // un margen anterior y el solape real se decide en cliente. Sin esto, una
    // cita que empieza antes de la ventana y termina dentro quedaría invisible y
    // check_availability ofrecería un hueco ya ocupado.
    const lookbackMs = MAX_APPOINTMENT_DURATION_MINUTES * 60_000;
    const windowStart = fromMs - lookbackMs;

    const records: HubspotObjectRecord[] = [];
    let after: string | undefined;

    // Paginación: el endpoint permite 200 por página; sin recorrer `paging.next`
    // se perderían citas en silencio.
    do {
      const response: HubspotSearchResponse = await this.client.post<HubspotSearchResponse>(
        this.appointmentsPath('/search'),
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: this.startProperty,
                  operator: 'BETWEEN',
                  value: String(windowStart),
                  highValue: String(toMs),
                },
              ],
            },
          ],
          properties: this.readProperties,
          limit: SEARCH_PAGE_SIZE,
          sorts: [{ propertyName: this.startProperty, direction: 'ASCENDING' }],
          ...(after ? { after } : {}),
        },
        { operation: 'searchAppointments', search: true },
      );

      records.push(...(response.results ?? []));
      after = response.paging?.next?.after;
    } while (after);

    const active = records.filter((record) => !isCanceledStatus(firstProperty(record, this.statusProperty)));

    // Solape real: start < to && end > from.
    return active
      .filter((record) => {
        const startMs = this.recordStartMillis(record);
        if (startMs === null) return false;
        return startMs < toMs && this.recordEndMillis(record, startMs) > fromMs;
      })
      .map((record) => asBookedAppointment(record, this.statusProperty));
  }

  /** Inicio de la cita en epoch (ms), o null si la propiedad no es una fecha válida. */
  private recordStartMillis(record: HubspotObjectRecord): number | null {
    const raw = firstProperty(record, this.startProperty, DATE_PROPERTY, CUSTOM_APPOINTMENT_PROPERTIES.start);
    return parseDatetime(raw)?.getTime() ?? null;
  }

  /** Fin de la cita en epoch (ms); si falta o es inválido, se asume la duración por defecto. */
  private recordEndMillis(record: HubspotObjectRecord, startMs: number): number {
    const raw = firstProperty(record, this.endProperty, END_PROPERTY, CUSTOM_APPOINTMENT_PROPERTIES.end);
    const endMs = parseDatetime(raw)?.getTime();
    if (endMs !== undefined && endMs > startMs) return endMs;
    return startMs + DEFAULT_APPOINTMENT_MINUTES * 60_000;
  }

  async createAppointment(input: ICreateAppointmentRecord): Promise<IBookedAppointmentRecord> {
    const start = toHubspotDateTime(input.scheduledTime);

    // Idempotencia: el cliente HTTP reintenta POST ante timeout/5xx, y la
    // escritura puede haber llegado. Si ya existe la cita de este evento de
    // calendario, se devuelve en lugar de duplicarla.
    if (input.calendarEventId) {
      const existing = await this.findByCalendarEventId(input.calendarEventId);
      if (existing) return existing;
    }

    const durationMinutes = this.resolveDurationMinutes(input);
    const endIso = new Date(new Date(start).getTime() + durationMinutes * 60_000).toISOString();

    const properties: Record<string, string> = {
      [this.nameProperty]: this.buildAppointmentName(input),
      [this.startProperty]: start,
      [this.endProperty]: endIso,
      [this.statusProperty]: APPOINTMENT_STATUS.scheduled,
      [CUSTOM_APPOINTMENT_PROPERTIES.customerName]: input.customerName,
      // Idempotencia: un reintento del mismo evento de calendario no debe
      // generar una segunda cita lógica en el CRM.
      [CUSTOM_APPOINTMENT_PROPERTIES.externalId]:
        input.calendarEventId ?? `${input.customerName}:${start}`,
    };

    if (input.calendarEventId) {
      properties[CUSTOM_APPOINTMENT_PROPERTIES.calendarEventId] = input.calendarEventId;
    }
    if (input.email) properties[CUSTOM_APPOINTMENT_PROPERTIES.customerEmail] = input.email;
    if (input.phone) properties[CUSTOM_APPOINTMENT_PROPERTIES.customerPhone] = input.phone;
    if (input.notes) properties[CUSTOM_APPOINTMENT_PROPERTIES.notes] = input.notes;

    const body: Record<string, unknown> = { properties };
    if (input.leadId) {
      body.associations = [
        {
          to: { id: String(input.leadId) },
          types: [
            { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: this.associationTypeId },
          ],
        },
      ];
    }

    const record = await this.writeAppointment('POST', this.appointmentsPath(), body, 'createAppointment');

    return {
      id: String(record.id),
      scheduledTime: firstProperty(record, this.startProperty) ?? start,
      customerName: input.customerName,
      email: input.email,
      phone: input.phone,
      status: APPOINTMENT_STATUS.scheduled,
      appointmentType: input.appointmentType,
      leadId: input.leadId,
      calendarEventId: input.calendarEventId,
      raw: record,
    };
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    const resolvedId = await this.resolveAppointmentId(appointmentId);
    const path = this.appointmentsPath(`/${encodeURIComponent(resolvedId)}`);

    // El objeto nativo de citas NO tiene propiedad de estado (verificado contra
    // el portal). Si la propiedad propia existe, se marca; si no, se archiva el
    // registro, que libera el hueco igual y deja de contar en disponibilidad.
    const available = await this.availableProperties();
    const canMarkStatus = available === null || available.has(this.statusProperty);

    if (canMarkStatus) {
      try {
        await this.writeAppointment(
          'PATCH',
          path,
          { properties: { [this.statusProperty]: APPOINTMENT_STATUS.canceled } },
          'cancelAppointment',
        );
        return;
      } catch (error) {
        // Sin la propiedad de estado, HubSpot responde 400 "no properties to
        // update": se degrada a archivado en lugar de fallar la cancelación.
        if (!(error instanceof CrmError) || error.code !== 'CRM_VALIDATION_ERROR') throw error;
      }
    }

    await this.archiveAppointment(resolvedId);
  }

  /**
   * Archiva (elimina lógicamente) el registro espejo de la cita.
   *
   * Es la degradación de la cancelación cuando el portal no tiene la propiedad
   * de estado: un objeto archivado no aparece en las búsquedas, así que la cita
   * deja de bloquear huecos. Se pierde el rastro del estado, no la corrección
   * funcional.
   */
  private async archiveAppointment(appointmentId: string): Promise<void> {
    await this.client.delete(
      this.appointmentsPath(`/${encodeURIComponent(appointmentId)}`),
      { operation: 'archiveAppointment' },
    );
  }

  async rescheduleAppointment(
    appointmentId: string,
    newScheduledTime: string,
  ): Promise<IBookedAppointmentRecord> {
    const start = toHubspotDateTime(newScheduledTime);
    const resolvedId = await this.resolveAppointmentId(appointmentId);
    const current = await this.getAppointment(resolvedId);
    const durationMinutes = this.durationFromRecord(current) ?? 30;
    const end = new Date(new Date(start).getTime() + durationMinutes * 60_000).toISOString();

    // Se conservan los datos que PATCH no modifica (cliente, email, teléfono y
    // vínculo con el contacto) para devolver un registro completo del puerto.
    const previous = current ? asBookedAppointment(current, this.statusProperty) : null;

    const record = await this.writeAppointment(
      'PATCH',
      this.appointmentsPath(`/${encodeURIComponent(resolvedId)}`),
      {
        properties: {
          [this.startProperty]: start,
          [this.endProperty]: end,
          [this.statusProperty]: APPOINTMENT_STATUS.scheduled,
        },
      },
      'rescheduleAppointment',
    );

    const updated = asBookedAppointment(record, this.statusProperty);
    return {
      ...updated,
      id: String(record.id ?? resolvedId),
      scheduledTime: updated.scheduledTime || start,
      customerName: updated.customerName || previous?.customerName || '',
      email: updated.email ?? previous?.email,
      phone: updated.phone ?? previous?.phone,
      calendarEventId: updated.calendarEventId ?? previous?.calendarEventId,
      // `leadId` se deja sin definir a propósito: la asociación con el contacto
      // vive en HubSpot, no en este registro, y la conversación ya conoce el lead.
    };
  }

  /**
   * Resuelve el identificador que llega desde la capa de tools hasta el id real
   * del registro en HubSpot.
   *
   * El tool de agendamiento registra el id del evento de Google Calendar, no el
   * de HubSpot. Autorizar ese id ya lo hizo la capa de tools (solo acepta citas
   * de la conversación actual); aquí solo se traduce al registro espejo. Sin esta
   * traducción, cancelar o reprogramar apuntaba a un id inexistente en HubSpot:
   * la petición devolvía 404 y el espejo quedaba permanentemente en SCHEDULED.
   */
  private async resolveAppointmentId(rawId: string): Promise<string> {
    // 1. ¿Es ya un id de HubSpot?
    const direct = await this.getAppointment(rawId);
    if (direct) return String(direct.id ?? rawId);

    // 2. Puede ser el id del evento de Google Calendar.
    const byCalendar = await this.findByCalendarEventId(rawId);
    if (byCalendar) return byCalendar.id;

    throw new CrmError({
      code: 'CRM_NOT_FOUND',
      message: `No appointment in the CRM matches "${rawId}" (tried record id and calendar event id).`,
      status: 404,
      retryable: false,
    });
  }

  /**
   * Busca la cita espejo de un evento de Google Calendar por las propiedades de
   * identidad externa. Se prefieren las no canceladas y la más reciente.
   */
  private async findByCalendarEventId(calendarEventId: string): Promise<IBookedAppointmentRecord | null> {
    const filterGroups = [
      {
        filters: [
          {
            propertyName: CUSTOM_APPOINTMENT_PROPERTIES.calendarEventId,
            operator: 'EQ',
            value: calendarEventId,
          },
        ],
      },
      {
        filters: [
          {
            propertyName: CUSTOM_APPOINTMENT_PROPERTIES.externalId,
            operator: 'EQ',
            value: calendarEventId,
          },
        ],
      },
    ];

    try {
      const response = await this.client.post<HubspotSearchResponse>(
        this.appointmentsPath('/search'),
        {
          filterGroups,
          properties: this.readProperties,
          limit: 5,
          sorts: [{ propertyName: this.startProperty, direction: 'DESCENDING' }],
        },
        { operation: 'findByCalendarEventId', search: true },
      );

      const records = response.results ?? [];
      if (records.length === 0) return null;

      const preferred =
        records.find((record) => !isCanceledStatus(firstProperty(record, this.statusProperty))) ??
        records[0];

      return asBookedAppointment(preferred, this.statusProperty);
    } catch (error) {
      // La búsqueda de identidad externa es opcional: si el portal no permite
      // filtrar esas propiedades, se degrada a "no encontrado" en lugar de
      // romper el agendamiento.
      if (error instanceof CrmError && error.code === 'CRM_VALIDATION_ERROR') return null;
      throw error;
    }
  }

  private async getAppointment(appointmentId: string): Promise<HubspotObjectRecord | null> {
    try {
      return await this.client.get<HubspotObjectRecord>(
        this.appointmentsPath(
          `/${encodeURIComponent(appointmentId)}?properties=${this.readProperties.join(',')}`,
        ),
        { operation: 'getAppointment' },
      );
    } catch (error) {
      if (error instanceof CrmError && error.code === 'CRM_NOT_FOUND') return null;
      throw error;
    }
  }

  private durationFromRecord(record: HubspotObjectRecord | null): number | null {
    if (!record) return null;
    const start = parseDatetime(firstProperty(record, this.startProperty));
    const end = parseDatetime(firstProperty(record, this.endProperty));
    if (!start || !end) return null;
    const diff = end.getTime() - start.getTime();
    if (!Number.isFinite(diff) || diff <= 0) return null;
    return Math.round(diff / 60_000);
  }

  private buildAppointmentName(input: ICreateAppointmentRecord): string {
    const type = input.appointmentType?.trim();
    return type ? `Synckre ${type} — ${input.customerName}` : `Synckre Appointment — ${input.customerName}`;
  }
  /**
   * Duración efectiva de la cita en minutos. Prioriza el valor explícito del
   * puerto; acepta también `duration=` en las notas por compatibilidad.
   */
  private resolveDurationMinutes(input: ICreateAppointmentRecord): number {
    if (input.durationMinutes && input.durationMinutes > 0 && input.durationMinutes <= 240) {
      return input.durationMinutes;
    }
    const fromNotes = (input.notes ?? '').match(/duration=(\d{1,3})/);
    if (fromNotes) {
      const minutes = Number(fromNotes[1]);
      if (Number.isFinite(minutes) && minutes > 0 && minutes <= 240) return minutes;
    }
    return 30;
  }

  /**
   * Escribe una cita. Si el portal rechaza las propiedades personalizadas
   * (por ejemplo porque el objeto nativo no las admite todavía), reintenta
   * usando únicamente las propiedades del objeto estándar.
   */
  private async writeAppointment(
    method: 'POST' | 'PATCH',
    path: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<HubspotObjectRecord> {
    // Se descartan de entrada las propiedades que el objeto no admite.
    const available = await this.availableProperties();
    if (available) {
      const properties = (body.properties ?? {}) as Record<string, string>;
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (available.has(key)) filtered[key] = value;
      }
      body = { ...body, properties: filtered };
    }

    try {
      return method === 'POST'
        ? await this.client.post<HubspotObjectRecord>(path, body, { operation })
        : await this.client.patch<HubspotObjectRecord>(path, body, { operation });
    } catch (error) {
      if (!(error instanceof CrmError) || error.code !== 'CRM_VALIDATION_ERROR') {
        throw error;
      }

      const properties = (body.properties ?? {}) as Record<string, string>;
      const customKeys = new Set<string>([
        ...(Object.values(CUSTOM_APPOINTMENT_PROPERTIES) as readonly string[]),
        NATIVE_STATUS_PROPERTY,
      ]);
      const stripped: Record<string, string> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (!customKeys.has(key)) stripped[key] = value;
      }

      if (Object.keys(stripped).length === Object.keys(properties).length) {
        throw error; // Nada que quitar: el error es de otra naturaleza.
      }

      const fallbackBody = { ...body, properties: stripped };
      return method === 'POST'
        ? await this.client.post<HubspotObjectRecord>(path, fallbackBody, {
            operation: `${operation}WithoutCustomProps`,
          })
        : await this.client.patch<HubspotObjectRecord>(path, fallbackBody, {
            operation: `${operation}WithoutCustomProps`,
          });
    }
  }

  /**
   * Nombres de propiedad que el objeto de citas admite de verdad, sondeados una
   * vez y cacheados. Escribir una propiedad inexistente devuelve 400, así que el
   * adaptador se limita a lo que el portal tiene: así funciona con o sin el
   * bootstrap de propiedades ejecutado.
   */
  private async availableProperties(): Promise<Set<string> | null> {
    if (this.propertyNames !== null) return this.propertyNames;
    try {
      const payload = await this.client.get<unknown>(
        `/crm/properties/${this.client.apiVersion}/${this.objectType}`,
        { operation: 'probeAppointmentProperties' },
      );
      const list = Array.isArray(payload)
        ? payload
        : ((payload as { results?: unknown } | null)?.results ?? []);
      if (!Array.isArray(list) || list.length === 0) {
        this.propertyNames = null;
        return null;
      }
      this.propertyNames = new Set(
        (list as Array<{ name?: string }>).map((p) => String(p.name ?? '')).filter(Boolean),
      );
      return this.propertyNames;
    } catch {
      // Si no se puede sondear (falta de scope), no se filtra: se intenta escribir
      // y el reintento degradado se encarga.
      this.propertyNames = null;
      return null;
    }
  }

  private appointmentsPath(suffix = ''): string {
    return `/crm/objects/${this.client.apiVersion}/${this.objectType}${suffix}`;
  }

  /**
   * El objeto nativo usa las propiedades `hs_appointment_*`; un objeto
   * personalizado usa las `synckre_*`. La elección se resuelve una vez.
   */
  private get startProperty(): string {
    return this.usesNativeObject ? DATE_PROPERTY : CUSTOM_APPOINTMENT_PROPERTIES.start;
  }

  private get endProperty(): string {
    return this.usesNativeObject ? END_PROPERTY : CUSTOM_APPOINTMENT_PROPERTIES.end;
  }

  private get nameProperty(): string {
    return this.usesNativeObject ? NAME_PROPERTY : CUSTOM_APPOINTMENT_PROPERTIES.name;
  }

  private get statusProperty(): string {
    // Tanto en el objeto nativo como en uno personalizado el estado es propio.
    return this.usesNativeObject ? NATIVE_STATUS_PROPERTY : CUSTOM_APPOINTMENT_PROPERTIES.status;
  }

  private get readProperties(): string[] {
    return [
      this.startProperty,
      this.endProperty,
      this.nameProperty,
      this.statusProperty,
      CUSTOM_APPOINTMENT_PROPERTIES.customerName,
      CUSTOM_APPOINTMENT_PROPERTIES.customerEmail,
      CUSTOM_APPOINTMENT_PROPERTIES.customerPhone,
      CUSTOM_APPOINTMENT_PROPERTIES.calendarEventId,
      CUSTOM_APPOINTMENT_PROPERTIES.externalId,
    ];
  }
}
