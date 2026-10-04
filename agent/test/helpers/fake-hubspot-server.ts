/**
 * Simulador en memoria de la API REST de HubSpot para tests de integración.
 *
 * No es un mock de conveniencia: reproduce las rarezas documentadas de la API que
 * ya han causado defectos reales en esta integración, para que los tests fallen
 * si el código deja de manejarlas.
 *
 *  1. Sólo devuelve las propiedades solicitadas en `body.properties`.
 *  2. `context` de los errores es un objeto cuyos VALORES son arrays de strings
 *     (`{propertyName: ['x']}`), no un string.
 *  3. `email` es única: un alta duplicada devuelve un error de duplicado.
 *  4. Los teléfonos se normalizan en propiedades calculadas
 *     (`hs_searchable_calculated_phone_number`), no en `phone`.
 *  5. La búsqueda es EVENTUALMENTE CONSISTENTE: un registro recién creado no
 *     aparece hasta que el índice se refresca.
 *  6. El objeto nativo de citas rechaza propiedades personalizadas.
 *  7. Un `Retry-After` de política diaria puede pedir horas.
 */

export interface FakeRecord {
  id: string;
  objectType: string;
  properties: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  associations: Array<{ toObjectType: string; toId: string; typeId: number }>;
  /** Un objeto archivado no aparece en las búsquedas (comportamiento real). */
  archived?: boolean;
}

export interface FakeHubspotOptions {
  /** Propiedades personalizadas de contacto que el portal reconoce. */
  knownContactProperties?: string[];
  /** Propiedades personalizadas que reconoce el objeto de citas. */
  knownAppointmentProperties?: string[];
  /** Si es false, el objeto nativo rechaza las propiedades synckre_* de cita. */
  appointmentAcceptsCustomProperties?: boolean;
  /**
   * Propiedades NATIVAS que el objeto de citas reconoce. En el portal real sólo
   * existen `hs_appointment_name/start/end`: no hay propiedad de estado, así que
   * escribirlo provoca un 400 (comprobado contra el portal).
   */
  nativeAppointmentProperties?: string[];
  /** Nº de escrituras antes de que un registro sea visible en el índice de búsqueda. */
  searchIndexDelayWrites?: number;
  /** Emails ya existentes (simula contactos creados antes del test). */
  seedContacts?: Array<{ email?: string; phone?: string; additionalEmails?: string[] }>;
}

export interface FakeRequestLog {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  /** Índice de la petición dentro del servidor. */
  index: number;
}

const DEFAULT_CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'phone',
  'company',
  'jobtitle',
  // Campo NATIVO donde se guarda el mensaje del cliente (verificado en el portal).
  'message',
  'lifecyclestage',
  'hs_lead_status',
  'createdate',
  'lastmodifieddate',
  'hs_additional_emails',
  'mobilephone',
  'hs_searchable_calculated_phone_number',
  'hs_searchable_calculated_mobile_number',
  // Propiedades que crea `npm run hubspot:bootstrap`.
  'synckre_company_name',
  'synckre_topic',
  'synckre_source',
  'synckre_conversation_id',
];

const DEFAULT_APPOINTMENT_CUSTOM_PROPERTIES = [
  'synckre_scheduled_time',
  'synckre_scheduled_end',
  'synckre_status',
  'synckre_customer_name',
  'synckre_customer_email',
  'synckre_customer_phone',
  'synckre_calendar_event_id',
  'synckre_external_id',
  'synckre_notes',
];

/**
 * Propiedades de tipo datetime. Igual que la API real: se ALMACENAN en ISO-8601
 * y se COMPARAN en epoch en los filtros de búsqueda. Confundir ambas formas fue
 * el origen de un defecto real (una fecha guardada como número no es parseable).
 */
const DATETIME_PROPERTY_PATTERN = /(^hs_timestamp$|_time$|_date$|^hs_appointment_(start|end)$)/;

function isDatetimeProperty(name: string): boolean {
  return DATETIME_PROPERTY_PATTERN.test(name);
}

/** Guarda en ISO, como la API real. */
function normalizeProperties(properties: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isDatetimeProperty(key)) {
      normalized[key] = value;
      continue;
    }
    const ms = new Date(value).getTime();
    normalized[key] = Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }
  return normalized;
}

/** Compara en epoch, como los filtros de la API real. */
function comparableValue(name: string, raw: string): string | number {
  if (!isDatetimeProperty(name)) return raw;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** Últimos 10 dígitos, como normaliza HubSpot los teléfonos. */
function searchablePhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

function errorResponse(
  status: number,
  category: string,
  message: string,
  errors?: Array<{ code: string; message: string; context?: Record<string, string[]> }>,
): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      category,
      message,
      correlationId: 'fake-correlation-id',
      ...(errors ? { errors } : {}),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

export class FakeHubspotServer {
  private readonly records = new Map<string, FakeRecord>();
  private readonly knownContactProperties: Set<string>;
  private readonly knownAppointmentProperties: Set<string>;
  private readonly options: Required<
    Pick<FakeHubspotOptions, 'appointmentAcceptsCustomProperties' | 'searchIndexDelayWrites'>
  > &
    FakeHubspotOptions;
  private sequence = 0;
  private writes = 0;
  /**
   * Nº de escrituras visibles en el índice. Una escritura lo refresca hasta su
   * propio punto (lo anterior queda indexado, lo nuevo no hasta la siguiente).
   */
  private indexedUpTo = 0;
  /**
   * Si no es null, todo lo escrito hasta ese punto queda EXCLUIDO de la búsqueda.
   * Modela un registro que el portal tiene pero el índice todavía no ve, y
   * sobrevive a escrituras posteriores (hasta `flushSearchIndex`).
   */
  private hiddenUpTo: number | null = null;
  /** Escrituras visibles al iniciar la búsqueda en curso (consistencia eventual). */
  private searchVisibleUpTo: number | null = null;

  readonly requests: FakeRequestLog[] = [];

  constructor(options: FakeHubspotOptions = {}) {
    this.options = {
      appointmentAcceptsCustomProperties: true,
      searchIndexDelayWrites: 0,
      ...options,
    };
    this.knownContactProperties = new Set(
      options.knownContactProperties ?? DEFAULT_CONTACT_PROPERTIES,
    );
    this.knownAppointmentProperties = new Set([
      // Igual que el portal real: el objeto nativo sólo tiene name/start/end.
      // El estado es una propiedad propia.
      ...(options.nativeAppointmentProperties ?? [
        'hs_appointment_name',
        'hs_appointment_start',
        'hs_appointment_end',
      ]),
      ...(options.knownAppointmentProperties ?? DEFAULT_APPOINTMENT_CUSTOM_PROPERTIES),
    ]);

    // Los contactos sembrados simulan registros que aún no están en el índice:
    // la búsqueda no los verá hasta que se refresque.
    for (const seed of options.seedContacts ?? []) {
      this.insert('contacts', {
        ...(seed.email ? { email: seed.email } : {}),
        ...(seed.phone ? { phone: seed.phone } : {}),
        ...(seed.additionalEmails?.length
          ? { hs_additional_emails: seed.additionalEmails.join(';') }
          : {}),
      });
    }
  }

  /** Instala el servidor como `globalThis.fetch`. Devuelve una función de limpieza. */
  install(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = this.fetch as unknown as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  /** Refresca el índice: todo lo escrito pasa a ser visible. */
  flushSearchIndex(): void {
    this.indexedUpTo = this.writes;
    this.hiddenUpTo = null;
  }

  /**
   * Oculta de la búsqueda todo lo escrito hasta ahora, simulando un registro que
   * el portal tiene pero el índice todavía no ve. Se reindexa con
   * `flushSearchIndex()`.
   */
  hideFromSearchIndex(): void {
    this.hiddenUpTo = this.writes;
  }

  /** Peticiones registradas que coinciden con un método y una ruta. */
  requestCount(method: string, pathSuffix: string): number {
    return this.requests.filter(
      (r) => r.method === method.toUpperCase() && r.path.endsWith(pathSuffix),
    ).length;
  }

  recordsOfType(objectType: string): FakeRecord[] {
    return [...this.records.values()].filter((r) => r.objectType === objectType);
  }

  getRecord(id: string): FakeRecord | undefined {
    return this.records.get(id);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private insert(
    objectType: string,
    properties: Record<string, string>,
    associations: FakeRecord['associations'] = [],
  ): FakeRecord {
    const now = new Date().toISOString();
    const record: FakeRecord = {
      id: this.nextId(objectType === 'contacts' ? 'contact' : objectType),
      objectType,
      properties: normalizeProperties(properties),
      createdAt: now,
      updatedAt: now,
      associations,
    };
    this.records.set(record.id, record);
    this.writes += 1;
    (record as FakeRecord & { __writeSeq: number }).__writeSeq = this.writes;
    // Escribir refresca el índice hasta ese punto: lo anterior pasa a ser
    // visible, lo nuevo no hasta la siguiente búsqueda (consistencia eventual).
    this.indexedUpTo = Math.max(this.indexedUpTo, this.writes);
    return record;
  }

  /** Proyecta sólo las propiedades solicitadas, como hace la API real. */
  private project(record: FakeRecord, requested?: string[]): Record<string, unknown> {
    const props = requested ?? Object.keys(record.properties);
    const properties: Record<string, string> = {};
    for (const name of props) {
      const value = record.properties[name];
      if (value !== undefined) properties[name] = value;
    }
    return {
      id: record.id,
      properties,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Validación de propiedades
  // ---------------------------------------------------------------------------
  private rejectUnknownProperties(
    objectType: string,
    properties: Record<string, string>,
  ): Response | null {
    if (objectType === 'contacts') {
      const unknown = Object.keys(properties).filter((p) => !this.knownContactProperties.has(p));
      if (unknown.length > 0) {
        // Forma REAL del error: context con arrays de strings.
        return errorResponse(400, 'VALIDATION_ERROR', 'Property does not exist', [
          {
            code: 'PROPERTY_DOESNT_EXIST',
            message: `Property "${unknown[0]}" does not exist`,
            context: { propertyName: unknown },
          },
        ]);
      }
      return null;
    }

    const unknown = Object.keys(properties).filter((p) => !this.knownAppointmentProperties.has(p));
    const customUnknown = unknown.filter((p) => p.startsWith('synckre_'));

    if (unknown.length > 0 && customUnknown.length > 0) {
      return errorResponse(400, 'VALIDATION_ERROR', 'One or more properties do not exist', [
        { code: 'PROPERTY_DOESNT_EXIST', message: 'Property does not exist' },
      ]);
    }

    if (objectType === 'appointments' && !this.options.appointmentAcceptsCustomProperties) {
      const custom = Object.keys(properties).filter((p) => p.startsWith('synckre_'));
      if (custom.length > 0) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Properties cannot be set on this object', [
          { code: 'PROPERTY_DOESNT_EXIST', message: 'Property does not exist' },
        ]);
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Búsqueda
  // ---------------------------------------------------------------------------
  private matchesFilter(record: FakeRecord, filter: Record<string, unknown>): boolean {
    const name = String(filter.propertyName ?? '');
    const operator = String(filter.operator ?? 'EQ');
    const raw = record.properties[name];

    switch (operator) {
      case 'EQ':
        return raw === String(filter.value);
      case 'NEQ':
        return raw !== String(filter.value);
      case 'HAS_PROPERTY':
        return raw !== undefined && raw !== '';
      case 'NOT_HAS_PROPERTY':
        return raw === undefined || raw === '';
      case 'CONTAINS_TOKEN': {
        if (raw === undefined) return false;
        const needle = String(filter.value).toLowerCase();
        return raw
          .toLowerCase()
          .split(/[;,\s]+/)
          .some((token) => token.includes(needle));
      }
      case 'BETWEEN': {
        if (raw === undefined) return false;
        const value = Number(comparableValue(name, raw));
        return value >= Number(filter.value) && value <= Number(filter.highValue);
      }
      default:
        return false;
    }
  }

  private searchRecords(objectType: string, body: Record<string, any>): FakeRecord[] {
    // Consistencia eventual: sólo son visibles los registros escritos ANTES de
    // que empezara esta búsqueda. Lo escrito durante ella aparece en la siguiente.
    const visibleUpTo = this.searchVisibleUpTo ?? this.indexedUpTo;
    let candidates = this.recordsOfType(objectType).filter((record) => {
      if (record.archived) return false;
      const seq = (record as FakeRecord & { __writeSeq?: number }).__writeSeq ?? 0;
      if (seq > visibleUpTo) return false;
      // Lo oculto no se revela por una escritura posterior, sólo por un flush.
      if (this.hiddenUpTo !== null && seq <= this.hiddenUpTo) return false;
      return true;
    });

    if (body.query) {
      const needle = String(body.query).toLowerCase().replace(/\D/g, '');
      candidates = candidates.filter((record) =>
        Object.values(record.properties).some((value) => {
          const digits = value.toLowerCase().replace(/\D/g, '');
          if (needle.length > 0 && digits.length > 0 && digits.includes(needle)) return true;
          return value.toLowerCase().includes(String(body.query).toLowerCase());
        }),
      );
    }

    const filterGroups = (body.filterGroups ?? []) as Array<{
      filters: Array<Record<string, unknown>>;
    }>;
    if (filterGroups.length > 0) {
      candidates = candidates.filter((record) =>
        filterGroups.some((group) =>
          (group.filters ?? []).every((filter) => this.matchesFilter(record, filter)),
        ),
      );
    }

    const sorted = [...candidates];
    const sorts = (body.sorts ?? []) as Array<{ propertyName: string; direction: string }>;
    if (sorts.length > 0) {
      const { propertyName, direction } = sorts[0];
      sorted.sort((a, b) => {
        const av = a.properties[propertyName] ?? '';
        const bv = b.properties[propertyName] ?? '';
        return direction === 'DESCENDING' ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }

    return sorted;
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  private readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : undefined;

    this.requests.push({ method, path, body, index: this.requests.length });

    const auth = new Headers(init?.headers).get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return errorResponse(401, 'INVALID_AUTHENTICATION', 'Authentication credentials not found');
    }

    // --- Propiedades y grupos -------------------------------------------------
    const propertiesMatch = path.match(/^\/crm\/properties\/[^/]+\/([^/]+)(\/groups)?$/);
    if (propertiesMatch && method === 'GET') {
      const objectType = propertiesMatch[1];
      // La API real envuelve estas colecciones en { results: [...] } (verificado
      // contra el portal). Devolver arrays planos ocultaba un fallo real.
      if (propertiesMatch[2]) {
        return Response.json({
          results: [
            { name: objectType === 'contacts' ? 'contactinformation' : 'appointment_information' },
          ],
        });
      }
      const known =
        objectType === 'contacts' ? this.knownContactProperties : this.knownAppointmentProperties;
      return Response.json({
        results: [...known].map((name) => ({ name, label: name, type: 'string', fieldType: 'text' })),
      });
    }

    // --- Etiquetas de asociación ---------------------------------------------
    if (/^\/crm\/associations\/[^/]+\/[^/]+\/[^/]+\/labels$/.test(path) && method === 'GET') {
      const [, , , from, to] = path.split('/');
      const typeId = from === 'appointments' && to === 'contact' ? 906 : 202;
      return Response.json({
        results: [{ category: 'HUBSPOT_DEFINED', typeId, label: `${from}_to_${to}` }],
      });
    }

    // --- Búsqueda -------------------------------------------------------------
    const searchMatch = path.match(/^\/crm\/objects\/[^/]+\/([^/]+)\/search$/);
    if (searchMatch && method === 'POST') {
      const objectType = searchMatch[1];
      // Snapshot al iniciar la búsqueda: lo escrito a partir de aquí no es visible.
      // No se toca `indexedUpTo`: es lo que permite simular un registro que aún
      // no está indexado (ver `hideFromSearchIndex`).
      // Techo: lo indexado y lo escrito antes de esta búsqueda.
      this.searchVisibleUpTo = Math.min(this.indexedUpTo, this.writes);
      const results = this.searchRecords(objectType, body ?? {});
      this.searchVisibleUpTo = null;
      const limit = Number(body?.limit ?? 10);
      const page = results.slice(0, limit);
      return Response.json({
        total: results.length,
        results: page.map((record) => this.project(record, body?.properties)),
        ...(results.length > limit && body?.after
          ? {}
          : results.length > limit
            ? { paging: { next: { after: 'cursor-1' } } }
            : {}),
      });
    }

    // --- Asociación por defecto ----------------------------------------------
    const defaultAssocMatch = path.match(
      /^\/crm\/objects\/[^/]+\/([^/]+)\/([^/]+)\/associations\/default\/([^/]+)\/([^/]+)$/,
    );
    if (defaultAssocMatch && method === 'PUT') {
      const [, , fromId, toType, toId] = defaultAssocMatch;
      const record = this.records.get(fromId);
      if (!record) return errorResponse(404, 'OBJECT_NOT_FOUND', 'Record not found');
      if (!this.records.has(toId)) return errorResponse(404, 'OBJECT_NOT_FOUND', 'Target not found');
      record.associations.push({ toObjectType: toType, toId, typeId: 0 });
      return Response.json({});
    }

    // --- CRUD -----------------------------------------------------------------
    const crudMatch = path.match(/^\/crm\/objects\/[^/]+\/([^/]+)(?:\/([^/]+))?$/);
    if (crudMatch) {
      const objectType = crudMatch[1];
      const id = crudMatch[2];

      if (method === 'GET' && id) {
        const record = this.records.get(id);
        if (!record || record.objectType !== objectType || record.archived) {
          return errorResponse(404, 'OBJECT_NOT_FOUND', 'Record not found');
        }
        const requested = url.searchParams.get('properties')?.split(',').filter(Boolean);
        return Response.json(this.project(record, requested));
      }

      if (method === 'POST' && !id) {
        const properties = (body?.properties ?? {}) as Record<string, string>;

        // El objeto de notas tiene su propio conjunto de propiedades.
        if (objectType === 'notes') {
          const allowed = ['hs_timestamp', 'hs_note_body', 'hs_engagement_thread_id', 'hubspot_owner_id'];
          const unknown = Object.keys(properties).filter((p) => !allowed.includes(p));
          if (unknown.length > 0) {
            return errorResponse(400, 'VALIDATION_ERROR', 'Property does not exist', [
              {
                code: 'PROPERTY_DOESNT_EXIST',
                message: `Property "${unknown[0]}" does not exist`,
                context: { propertyName: unknown },
              },
            ]);
          }
          const associations = (body?.associations ?? []) as Array<{
            to: { id: string };
            types: Array<{ associationTypeId: number }>;
          }>;
          const record = this.insert(
            objectType,
            properties,
            associations.map((a) => ({
              toObjectType: 'contacts',
              toId: String(a.to.id),
              typeId: a.types?.[0]?.associationTypeId ?? 0,
            })),
          );
          return Response.json(this.project(record), { status: 201 });
        }

        const rejection = this.rejectUnknownProperties(objectType, properties);
        if (rejection) return rejection;

        // Un contacto existente puede tener propiedades personalizadas que el
        // portal aprendió después: si el alta choca con él, el contacto
        // resultante debe incluir sus datos aunque el alta no los enviara.
        if (objectType === 'contacts' && properties.email) {
          const duplicate = this.recordsOfType('contacts').find(
            (r) =>
              r.properties.email === properties.email ||
              (r.properties.hs_additional_emails ?? '')
                .split(';')
                .map((e) => e.trim())
                .includes(properties.email),
          );
          if (duplicate) {
            // HubSpot señala el duplicado con 409.
            return errorResponse(409, 'CONFLICT', 'Contact already exists', [
              { code: 'CONTACT_EXISTS', message: 'Contact already exists' },
            ]);
          }
        }

        // HubSpot normaliza el teléfono en propiedades calculadas.
        if (objectType === 'contacts' && properties.phone) {
          const normalized = searchablePhone(properties.phone);
          if (normalized) {
            properties.hs_searchable_calculated_phone_number = normalized;
            properties.hs_searchable_calculated_mobile_number = normalized;
          }
        }

        const associations = (body?.associations ?? []) as Array<{
          to: { id: string };
          types: Array<{ associationTypeId: number }>;
        }>;

        const record = this.insert(
          objectType,
          properties,
          associations.map((a) => ({
            toObjectType: 'unknown',
            toId: String(a.to.id),
            typeId: a.types?.[0]?.associationTypeId ?? 0,
          })),
        );
        return Response.json(this.project(record), { status: 201 });
      }

      if (method === 'DELETE' && id) {
        const record = this.records.get(id);
        if (!record) return errorResponse(404, 'OBJECT_NOT_FOUND', 'Record not found');
        record.archived = true;
        return new Response(null, { status: 204 });
      }

      if (method === 'PATCH' && id) {
        const record = this.records.get(id);
        if (!record) return errorResponse(404, 'OBJECT_NOT_FOUND', 'Record not found');
        const properties = (body?.properties ?? {}) as Record<string, string>;
        const rejection = this.rejectUnknownProperties(objectType, properties);
        if (rejection) return rejection;
        Object.assign(record.properties, normalizeProperties(properties));
        record.updatedAt = new Date().toISOString();
        return Response.json(this.project(record));
      }
    }

    return errorResponse(404, 'OBJECT_NOT_FOUND', `No fake route for ${method} ${path}`);
  };
}
