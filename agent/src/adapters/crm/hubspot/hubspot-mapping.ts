import { ILead, ILeadDraft } from '@core/ports/crm.port';

/**
 * Forma de un registro de contacto de HubSpot tal como lo devuelve la API.
 */
export interface HubspotObjectRecord {
  id: string;
  properties?: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
  [key: string]: unknown;
}

export interface HubspotSearchResponse {
  total?: number;
  results?: HubspotObjectRecord[];
  paging?: { next?: { after?: string } };
}

/**
 * Propiedades estándar de HubSpot que pedimos siempre en lecturas y búsquedas.
 *
 * HubSpot devuelve ÚNICAMENTE las propiedades solicitadas, así que las que usan
 * los verificadores de identidad (`recordMatchesEmail` / `recordMatchesPhone`)
 * tienen que estar aquí o la verificación fallaría en cerrado y crearíamos
 * contactos duplicados para personas que ya existen.
 */
export const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'phone',
  // Formas alternativas en las que HubSpot guarda o normaliza un teléfono.
  'mobilephone',
  'hs_searchable_calculated_phone_number',
  'hs_searchable_calculated_mobile_number',
  // Emails adicionales de contactos nativos de HubSpot.
  'hs_additional_emails',
  'company',
  'jobtitle',
  'lifecyclestage',
  'hs_lead_status',
  'createdate',
  'lastmodifieddate',
] as const;

/**
 * Propiedades personalizadas que el adaptador intenta escribir.
 * Si la Private App todavía no las tiene creadas, el adaptador reintenta sin ellas
 * en lugar de fallar, de modo que la migración funciona antes y después del bootstrap.
 */
export const OPTIONAL_CONTACT_PROPERTIES = [
  'synckre_company_name',
  'synckre_topic',
  'synckre_source',
  'synckre_conversation_id',
] as const;

/** Divide un nombre completo en nombre y apellido para el modelo de HubSpot. */
export function splitFullName(name?: string): { firstname?: string; lastname?: string } {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) return {};
  const parts = clean.split(' ');
  if (parts.length === 1) return { firstname: parts[0] };
  return {
    firstname: parts.slice(0, -1).join(' '),
    lastname: parts[parts.length - 1],
  };
}

/**
 * HubSpot normaliza los teléfonos en propiedades calculadas y busca por
 * área + número local, sin código de país. Extraemos los últimos 10 dígitos.
 */
export function toSearchablePhone(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return digits.length >= 7 ? digits : null;
  return digits.slice(-10);
}

function cleanProperty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Une nombre y apellido en un único `name` para el puerto. */
export function joinFullName(record: HubspotObjectRecord): string | undefined {
  const props = record.properties ?? {};
  const first = cleanProperty(props.firstname);
  const last = cleanProperty(props.lastname);
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return combined.length > 0 ? combined : undefined;
}

/** Mapea un registro de contacto de HubSpot al modelo `ILead` del puerto. */
export function asLead(record: HubspotObjectRecord): ILead {
  const props = record.properties ?? {};
  const company = cleanProperty(props.company) ?? cleanProperty(props.synckre_company_name);
  const status = cleanProperty(props.lifecyclestage) ?? cleanProperty(props.hs_lead_status);

  return {
    id: String(record.id),
    name: joinFullName(record),
    email: cleanProperty(props.email),
    phone: cleanProperty(props.phone),
    companyName: company,
    jobTitle: cleanProperty(props.jobtitle),
    status,
    createdAt: record.createdAt ?? cleanProperty(props.createdate),
    updatedAt: record.updatedAt ?? cleanProperty(props.lastmodifieddate),
    data: props as Record<string, unknown>,
  };
}

/**
 * Propiedades NATIVAS de contacto que el adaptador aprovecha para no depender de
 * propiedades personalizadas. `message` es el campo estándar de mensaje del
 * formulario y es visible en la vista normal de un contacto de HubSpot.
 */
export const NATIVE_MESSAGE_PROPERTY = 'message';

/**
 * Construye las propiedades de escritura para un contacto.
 * Devuelve por separado las propiedades opcionales para poder reintentar sin ellas.
 */
export function toContactProperties(
  draft: ILeadDraft,
  options: { source?: string; ownerId?: string; conversationId?: string } = {},
): { required: Record<string, string>; optional: Record<string, string> } {
  const { firstname, lastname } = splitFullName(draft.name);
  const required: Record<string, string> = {};
  const optional: Record<string, string> = {};

  if (firstname) required.firstname = firstname;
  if (lastname) required.lastname = lastname;
  if (draft.email) required.email = draft.email.trim().toLowerCase();
  if (draft.phone) required.phone = draft.phone.trim();
  if (draft.jobTitle) required.jobtitle = draft.jobTitle.trim();
  // `company` es la empresa primaria calculada de HubSpot y su escriturabilidad
  // no está garantizada por el esquema. Se escribe como opcional para que un
  // rechazo no impida guardar el lead: la empresa siempre queda además en
  // `synckre_company_name`.
  if (draft.companyName) optional.company = draft.companyName.trim();

  // Datos sin equivalente nativo en el puerto: van a propiedades personalizadas.
  const data = draft.data ?? {};

  // El mensaje del cliente va a un campo NATIVO: sobrevive aunque el portal no
  // tenga las propiedades personalizadas creadas.
  const rawMessage = data.message ?? draft.notes;
  if (typeof rawMessage === 'string' && rawMessage.trim() && !required[NATIVE_MESSAGE_PROPERTY]) {
    required[NATIVE_MESSAGE_PROPERTY] = rawMessage.trim().slice(0, 60_000);
  }

  const ownerId = options.ownerId ?? draft.ownerId;
  if (ownerId) {
    required.hubspot_owner_id = String(ownerId);
  }

  const companyName = draft.companyName ?? data.company_name ?? data.companyName;
  if (typeof companyName === 'string' && companyName.trim()) {
    optional.synckre_company_name = companyName.trim();
  }
  const topic = data.topic;
  if (typeof topic === 'string' && topic.trim()) {
    optional.synckre_topic = topic.trim();
  }
  const source = draft.source ?? options.source;
  if (source) {
    optional.synckre_source = String(source);
  }
  if (options.conversationId) {
    optional.synckre_conversation_id = options.conversationId;
  }

  return { required, optional };
}

/** Clave estable para cachear búsquedas dentro del proceso. */
export function queryCacheKey(email?: string, phone?: string): string {
  return `${email?.trim().toLowerCase() ?? ''}|${toSearchablePhone(phone) ?? ''}`;
}

/** Todos los emails de un contacto: principal y secundarios. */
export function contactEmails(record: HubspotObjectRecord): string[] {
  const props = record.properties ?? {};
  const values = [props.email, props.hs_additional_emails]
    .map((value) => cleanProperty(value))
    .filter((value): value is string => Boolean(value));
  // `hs_additional_emails` es una lista separada por punto y coma.
  return values
    .flatMap((value) => value.split(';'))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** Todos los teléfonos de un contacto, incluidos los calculados por HubSpot. */
export function contactPhones(record: HubspotObjectRecord): string[] {
  const props = record.properties ?? {};
  const keys = [
    'phone',
    'mobilephone',
    'hs_searchable_calculated_phone_number',
    'hs_searchable_calculated_mobile_number',
    'hs_whatsapp_phone_number',
  ];
  return keys
    .map((key) => cleanProperty(props[key]))
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(';'))
    .map((value) => value.trim())
    .filter(Boolean);
}

/** ¿El contacto contiene realmente el email consultado? */
export function recordMatchesEmail(record: HubspotObjectRecord, email: string): boolean {
  const target = email.trim().toLowerCase();
  return contactEmails(record).includes(target);
}

/**
 * ¿El contacto contiene realmente el teléfono consultado?
 *
 * Compara por los últimos 10 dígitos, que es como HubSpot normaliza los números
 * (área + número local, sin código de país).
 */
export function recordMatchesPhone(record: HubspotObjectRecord, phone: string): boolean {
  const target = toSearchablePhone(phone);
  if (!target) return false;
  return contactPhones(record).some((value) => toSearchablePhone(value) === target);
}
