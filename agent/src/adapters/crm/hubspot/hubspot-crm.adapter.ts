import {
  CrmError,
  IActivityNote,
  ICrm,
  ILead,
  ILeadDraft,
  ILeadQuery,
  normalizeActivityNote,
} from '@core/ports/crm.port';
import { HubspotHttpClient } from './hubspot-http.client';
import {
  CONTACT_PROPERTIES,
  HubspotObjectRecord,
  HubspotSearchResponse,
  OPTIONAL_CONTACT_PROPERTIES,
  asLead,
  queryCacheKey,
  recordMatchesEmail,
  recordMatchesPhone,
  toContactProperties,
  toSearchablePhone,
} from './hubspot-mapping';

export interface HubspotCrmAdapterConfig {
  readonly client: HubspotHttpClient;
  /** Asignación opcional de propietario en los contactos creados. */
  readonly defaultOwnerId?: string;
  /** Valor por defecto de la propiedad personalizada de origen. */
  readonly defaultSource?: string;
  /** Tipo de asociación nota -> contacto (nativo: 202). */
  readonly noteContactAssociationTypeId?: number;
  /**
   * TTL de la caché de búsquedas. Mitiga el techo de 5 req/s del endpoint de
   * búsqueda y absorbe las llamadas repetidas dentro de un mismo turno.
   */
  readonly searchCacheTtlMs?: number;
  readonly logger?: {
    warn(message: string, meta?: Record<string, unknown>): void;
  };
}

interface HubspotAssociation {
  to: { id: string };
  types: Array<{ associationCategory: string; associationTypeId: number }>;
}

const NOTE_BODY_MAX_LENGTH = 65_536;

/**
 * Tope de entradas de la caché de contactos. El agent corre en un proceso de
 * larga vida: sin límite, un servidor con mucho tráfico acumularía memoria.
 */
const MAX_LEAD_CACHE_ENTRIES = 500;

/** Parte local de un email, usada como token de búsqueda en propiedades calculadas. */
function localPart(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

export class HubspotCrmAdapter implements ICrm {
  private readonly client: HubspotHttpClient;
  private readonly defaultOwnerId?: string;
  private readonly defaultSource?: string;
  private readonly noteContactAssociationTypeId: number;
  private readonly searchCacheTtlMs: number;
  private readonly logger: { warn(message: string, meta?: Record<string, unknown>): void };

  /**
   * Propiedades que el objeto `contacts` admite de verdad (null = sin sondear).
   * Evita el doble viaje (intento + reintento degradado) cuando el portal todavía
   * no tiene creadas las propiedades personalizadas.
   */
  private contactPropertyNames: Set<string> | null = null;

  /** Caché de resultados de búsqueda; también actúa como dedupe dentro del proceso. */
  private readonly searchCache = new Map<string, { lead: ILead | null; expiresAt: number }>();
  private readonly leadCache = new Map<string, { lead: ILead; expiresAt: number }>();

  constructor(config: HubspotCrmAdapterConfig) {
    this.client = config.client;
    this.defaultOwnerId = config.defaultOwnerId;
    this.defaultSource = config.defaultSource;
    this.noteContactAssociationTypeId = config.noteContactAssociationTypeId ?? 202;
    this.searchCacheTtlMs = config.searchCacheTtlMs ?? 30_000;
    this.logger = config.logger ?? { warn: (message, meta) => console.warn(message, meta ?? '') };
  }

  async findLead(query: ILeadQuery): Promise<ILead | null> {
    const email = query.email?.trim().toLowerCase();
    const searchablePhone = toSearchablePhone(query.phone);

    if (!email && !searchablePhone) {
      return null;
    }

    const cacheKey = queryCacheKey(email, searchablePhone ?? undefined);
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.lead;
    }

    // Paso 1: coincidencia exacta por email principal o por teléfono.
    // `hs_additional_emails` es una propiedad calculada y no siempre es
    // filtrable, así que no se incluye aquí para no arriesgar un 400.
    const exactFilters: Array<Record<string, unknown>> = [];
    if (email) {
      exactFilters.push({ propertyName: 'email', operator: 'EQ', value: email });
    }
    if (searchablePhone) {
      exactFilters.push({ propertyName: 'phone', operator: 'EQ', value: searchablePhone });
    }

    let record =
      exactFilters.length > 0
        ? await this.searchOne(exactFilters.map((filter) => ({ filters: [filter] })))
        : null;

    // Paso 2: el email puede estar registrado como secundario en un contacto
    // nativo de HubSpot. Se busca aparte y se verifica en cliente.
    if (!record && email) {
      const bySecondary = await this.searchSecondaryEmail(email);
      if (bySecondary && recordMatchesEmail(bySecondary, email)) {
        record = bySecondary;
      }
    }

    // Paso 3: HubSpot normaliza los teléfonos en propiedades calculadas. La
    // búsqueda por texto libre es difusa, así que el resultado se verifica
    // contra el número consultado antes de vincularlo: jamás se debe atar la
    // conversación al contacto equivocado.
    if (!record && searchablePhone) {
      const byText = await this.searchOne(undefined, searchablePhone);
      if (byText && recordMatchesPhone(byText, searchablePhone)) {
        record = byText;
      }
    }

    const lead = record ? asLead(record) : null;
    this.searchCache.set(cacheKey, { lead, expiresAt: Date.now() + this.searchCacheTtlMs });
    if (lead) {
      this.rememberLead(lead);
    }
    return lead;
  }

  async getLeadById(id: string): Promise<ILead | null> {
    const cached = this.leadCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.lead;
    }

    // Los identificadores de contacto de HubSpot son numéricos. Un id con otro
    // formato proviene de otro sistema (p. ej. los `CRM-LEAD-0001` de ERPNext) y
    // no puede existir aquí: se avisa con claridad para no confundir un problema
    // de migración con un contacto borrado. Caso real: seguimientos programados
    // antes del corte que el worker intenta resolver.
    if (!/^\d+$/.test(id.trim())) {
      this.logger.warn(
        '[hubspot] contact id is not a HubSpot id (numeric); it probably comes from another CRM',
        { id },
      );
    }

    try {
      const record = await this.client.get<HubspotObjectRecord>(
        this.contactsPath(`/${encodeURIComponent(id)}?properties=${CONTACT_PROPERTIES.join(',')}`),
        { operation: 'getContact' },
      );
      const lead = asLead(record);
      this.rememberLead(lead);
      return lead;
    } catch (error) {
      if (error instanceof CrmError && error.code === 'CRM_NOT_FOUND') {
        return null;
      }
      throw error;
    }
  }

  async createLead(draft: ILeadDraft): Promise<ILead> {
    const { required, optional } = toContactProperties(draft, {
      ownerId: this.defaultOwnerId,
      source: this.defaultSource,
      conversationId: this.readConversationId(draft),
    });

    let record: HubspotObjectRecord;
    try {
      record = await this.writeContact('POST', this.contactsPath(), required, optional, 'createContact');
    } catch (error) {
      // El search de HubSpot es eventualmente consistente: dos envíos seguidos
      // pueden ver "sin coincidencias" y chocar al crear. Si el portal informa
      // de un duplicado, se recupera el contacto existente en lugar de perder el
      // lead o crear un segundo registro.
      if (!(error instanceof CrmError) || error.code !== 'CRM_CONFLICT') throw error;

      const existing = await this.recoverFromConflict(draft);
      if (!existing) throw error;
      return existing;
    }

    const lead = asLead(record);
    this.invalidateSearchCache();
    this.rememberLead(lead);

    // La nota inicial se registra como actividad asociada. Es best-effort: si
    // falla, el contacto ya está creado y no debe perderse por la nota.
    const initialNote = draft.notes ?? this.readDataNote(draft);
    if (initialNote?.trim()) {
      try {
        await this.appendLeadNote(lead.id, {
          body: initialNote,
          threadId: this.readConversationId(draft),
        });
      } catch (error) {
        this.logger.warn('[hubspot] initial lead note could not be saved', {
          contactId: lead.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Si el origen trae empresa, se refleja también como Company asociada.
    // Es best-effort pero NO silencioso: un fallo de scope o de tipo de
    // asociación debe quedar en los logs para poder diagnosticarlo.
    if (draft.companyName?.trim()) {
      void this.associateCompany(lead.id, draft.companyName.trim()).catch((error: unknown) => {
        this.logger.warn('[hubspot] company association failed', {
          contactId: lead.id,
          companyName: draft.companyName,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return lead;
  }

  async updateLead(id: string, draft: ILeadDraft): Promise<ILead> {
    const { required, optional } = toContactProperties(draft, {
      ownerId: this.defaultOwnerId,
      conversationId: this.readConversationId(draft),
    });

    const record = await this.writeContact(
      'PATCH',
      this.contactsPath(`/${encodeURIComponent(id)}`),
      required,
      optional,
      'updateContact',
    );

    const lead = asLead(record);
    this.rememberLead(lead);
    this.invalidateSearchCache();
    return lead;
  }

  async appendLeadNote(id: string, note: string | IActivityNote): Promise<void> {
    const normalized = normalizeActivityNote(note);
    const rawBody = (normalized.body ?? '').trim();
    if (!rawBody) return;

    const body =
      rawBody.length > NOTE_BODY_MAX_LENGTH
        ? `${rawBody.slice(0, NOTE_BODY_MAX_LENGTH - 20)}\n\n[truncated]`
        : rawBody;

    const createdAt = normalized.createdAt ? new Date(normalized.createdAt) : new Date();
    const properties: Record<string, string> = {
      hs_timestamp: String(Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime()),
      hs_note_body: body,
    };
    if (this.defaultOwnerId) {
      properties.hubspot_owner_id = this.defaultOwnerId;
    }
    if (normalized.threadId) {
      properties.hs_engagement_thread_id = normalized.threadId;
    }

    const associations: HubspotAssociation[] = [
      {
        to: { id: String(id) },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: this.noteContactAssociationTypeId,
          },
        ],
      },
    ];

    const payload = { properties, associations };

    try {
      await this.client.post(this.notesPath(), payload, {
        operation: 'createNote',
      });
    } catch (error) {
      // El hilo de engagement solo existe si la cuenta lo tiene habilitado:
      // reintentamos sin él antes de dar la nota por perdida.
      if (
        error instanceof CrmError &&
        error.code === 'CRM_VALIDATION_ERROR' &&
        properties.hs_engagement_thread_id
      ) {
        delete properties.hs_engagement_thread_id;
        await this.client.post(this.notesPath(), { properties, associations }, {
          operation: 'createNoteWithoutThread',
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Busca una empresa por dominio o nombre y la asocia al contacto.
   * Es best-effort: un fallo aquí no debe tumbar la creación del lead.
   */
  private async associateCompany(contactId: string, companyName: string): Promise<void> {
    const existing = await this.client.post<HubspotSearchResponse>(
      `/crm/objects/${this.client.apiVersion}/companies/search`,
      {
        filterGroups: [
          { filters: [{ propertyName: 'name', operator: 'EQ', value: companyName }] },
        ],
        properties: ['name'],
        limit: 1,
      },
      { operation: 'searchCompany', search: true },
    );

    let companyId = existing.results?.[0]?.id;

    if (!companyId) {
      const created = await this.client.post<HubspotObjectRecord>(
        `/crm/objects/${this.client.apiVersion}/companies`,
        { properties: { name: companyName } },
        { operation: 'createCompany' },
      );
      companyId = created.id;
    }

    // Endpoint de asociación por DEFECTO: no exige conocer el associationTypeId
    // y no puede reasignar la empresa principal de un contacto existente.
    await this.client.put(
      `/crm/objects/${this.client.apiVersion}/contacts/${encodeURIComponent(contactId)}/associations/default/company/${encodeURIComponent(companyId)}`,
      undefined,
      { operation: 'associateCompany' },
    );
  }

  /**
   * Escribe un contacto. Si el portal rechaza las propiedades personalizadas
   * porque todavía no existen, reintenta solo con las estándar: así la migración
   * funciona antes de ejecutar el bootstrap de propiedades.
   */
  private async writeContact(
    method: 'POST' | 'PATCH',
    path: string,
    required: Record<string, string>,
    optional: Record<string, string>,
    operation: string,
  ): Promise<HubspotObjectRecord> {
    // Se descartan de entrada las personalizadas que el portal no tiene: evita
    // un 400 y un reintento en cada escritura mientras no se ejecute el bootstrap.
    const available = await this.availableContactProperties();
    if (available) {
      for (const key of Object.keys(optional)) {
        if (!available.has(key)) delete optional[key];
      }
    }

    const hasOptional = Object.keys(optional).length > 0;

    try {
      const body = { properties: { ...required, ...optional } };
      return method === 'POST'
        ? await this.client.post<HubspotObjectRecord>(path, body, { operation })
        : await this.client.patch<HubspotObjectRecord>(path, body, { operation });
    } catch (error) {
      if (!hasOptional || !this.isRetryableWriteRejection(error)) {
        throw error;
      }

      const missing = this.extractMissingProperties(error).filter((name) =>
        (OPTIONAL_CONTACT_PROPERTIES as readonly string[]).includes(name),
      );

      // Si HubSpot no nombra la propiedad culpable, no podemos saber cuál es:
      // reintentamos solo con las estándar. Es la única degradación posible y
      // evita perder el lead por una propiedad personalizada ausente.
      const fallback: Record<string, string> = {};
      for (const [key, value] of Object.entries(optional)) {
        if (!missing.includes(key)) fallback[key] = value;
      }

      // Si el reintento fuese idéntico al primer intento, no aportaría nada:
      // en ese caso se prescinde de todas las opcionales.
      const unchanged =
        Object.keys(fallback).length === Object.keys(optional).length &&
        Object.entries(fallback).every(([k, v]) => optional[k] === v);

      const body = { properties: { ...required, ...(unchanged ? {} : fallback) } };
      return method === 'POST'
        ? await this.client.post<HubspotObjectRecord>(path, body, { operation: `${operation}WithoutCustomProps` })
        : await this.client.patch<HubspotObjectRecord>(path, body, {
            operation: `${operation}WithoutCustomProps`,
          });
    }
  }

  /**
   * ¿Merece la pena reintentar sin las propiedades personalizadas?
   *
   * La decisión es estructural, no textual: HubSpot responde 400 cuando rechaza
   * la escritura, y en ese caso la petición no se aplicó, así que reintentar una
   * sola vez sin las propiedades opcionales es seguro. Si el reintento también
   * falla, el error definitivo llega igualmente al llamador.
   */
  private isRetryableWriteRejection(error: unknown): error is CrmError {
    return error instanceof CrmError && error.code === 'CRM_VALIDATION_ERROR';
  }

  /**
   * Extrae los nombres de propiedad que HubSpot reporta como problemáticos.
   *
   * El esquema oficial tipa `context` como `object` cuyos VALORES son arrays de
   * strings (`{invalidPropertyName=[...], missingScopes=[...]}`), así que hay que
   * aceptar tanto `["prop"]` como `"prop"` y recorrer además las claves de la
   * raíz del error, que también traen contexto.
   */
  private extractMissingProperties(error: CrmError): string[] {
    const details = error.details as
      | {
          context?: Record<string, unknown>;
          errors?: Array<{ context?: Record<string, unknown> }>;
        }
      | undefined;

    const names = new Set<string>();
    const collectFrom = (context?: Record<string, unknown>): void => {
      if (!context) return;
      for (const [key, raw] of Object.entries(context)) {
        const values = Array.isArray(raw) ? raw : [raw];
        for (const value of values) {
          if (typeof value !== 'string') continue;
          // Solo nos interesan claves que designan nombres de propiedad.
          if (/propert/i.test(key)) names.add(value);
        }
      }
    };

    collectFrom(details?.context);
    for (const item of details?.errors ?? []) {
      collectFrom(item.context);
    }

    return [...names];
  }

  /**
   * Nombres de propiedad reales del objeto de contactos, sondeados una vez.
   * Si la sonda falla, se devuelve null y no se filtra (se deja actuar al
   * reintento degradado).
   */
  private async availableContactProperties(): Promise<Set<string> | null> {
    if (this.contactPropertyNames !== null) return this.contactPropertyNames;
    try {
      const payload = await this.client.get<unknown>(
        `/crm/properties/${this.client.apiVersion}/contacts`,
        { operation: 'probeContactProperties' },
      );
      const list = Array.isArray(payload)
        ? payload
        : ((payload as { results?: unknown } | null)?.results ?? []);
      if (!Array.isArray(list) || list.length === 0) return null;
      this.contactPropertyNames = new Set(
        (list as Array<{ name?: string }>).map((p) => String(p.name ?? '')).filter(Boolean),
      );
      return this.contactPropertyNames;
    } catch {
      return null;
    }
  }

  private async searchOne(
    filterGroups?: Array<Record<string, unknown>>,
    query?: string,
  ): Promise<HubspotObjectRecord | null> {
    const body: Record<string, unknown> = {
      properties: [...CONTACT_PROPERTIES],
      limit: 5,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    };
    if (filterGroups && filterGroups.length > 0) body.filterGroups = filterGroups;
    if (query) body.query = query;

    const response = await this.client.post<HubspotSearchResponse>(
      this.contactsPath('/search'),
      body,
      { operation: 'searchContacts', search: true },
    );

    return response.results?.[0] ?? null;
  }

  /** Guarda un contacto en la caché acotada. */
  private rememberLead(lead: ILead): void {
    if (this.leadCache.size >= MAX_LEAD_CACHE_ENTRIES) {
      this.leadCache.clear();
    }
    this.leadCache.set(lead.id, { lead, expiresAt: Date.now() + this.searchCacheTtlMs });
  }

  /**
   * Busca por email secundario. Es un camino opcional: si el portal rechaza el
   * filtro sobre la propiedad calculada, se degrada a "sin coincidencia" en
   * lugar de tumbar toda la búsqueda de leads.
   */
  private async searchSecondaryEmail(email: string): Promise<HubspotObjectRecord | null> {
    try {
      return await this.searchOne([
        {
          filters: [
            {
              propertyName: 'hs_additional_emails',
              operator: 'CONTAINS_TOKEN',
              value: localPart(email),
            },
          ],
        },
      ]);
    } catch (error) {
      if (error instanceof CrmError && error.code === 'CRM_VALIDATION_ERROR') {
        return null;
      }
      throw error;
    }
  }

  private invalidateSearchCache(): void {
    // Tras una escritura, la caché negativa dejaría de ser válida. La consistencia
    // eventual del search de HubSpot se compensa identificando siempre por ID.
    this.searchCache.clear();
  }

  /**
   * Recupera el contacto que provocó un conflicto de unicidad.
   * Se intenta por email y, si no, por teléfono.
   */
  private async recoverFromConflict(draft: ILeadDraft): Promise<ILead | null> {
    const existing = await this.findLead({ email: draft.email, phone: draft.phone });
    if (existing) {
      this.logger.warn('[hubspot] create conflicted with an existing contact; reusing it', {
        contactId: existing.id,
      });
      return existing;
    }
    return null;
  }

  /** Compatibilidad con el contrato histórico que enviaba la nota dentro de `data`. */
  private readDataNote(draft: ILeadDraft): string | undefined {
    const value = draft.data?.notes;
    return typeof value === 'string' ? value : undefined;
  }

  /** El identificador de conversación viaja dentro de `data` para no ensuciar el puerto. */
  /** El identificador de conversación viaja dentro de `data` para no ensuciar el puerto. */
  private readConversationId(draft: ILeadDraft): string | undefined {
    const value = draft.data?.conversation_id;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private contactsPath(suffix = ''): string {
    return `/crm/objects/${this.client.apiVersion}/contacts${suffix}`;
  }

  private notesPath(): string {
    return `/crm/objects/${this.client.apiVersion}/notes`;
  }
}
