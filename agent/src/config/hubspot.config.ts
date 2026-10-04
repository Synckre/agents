/**
 * Constantes de la integración con HubSpot.
 *
 * Todas están VERIFICADAS contra el portal real (ver `docs/hubspot-runbook.md`),
 * así que no se exponen como variables de entorno: menos configuración que pueda
 * quedar desincronizada de la realidad del portal.
 *
 * Si algún día se opera otro portal (EU, objeto personalizado), se cambian aquí.
 */
/** Versión de API fechada. HubSpot retira las versiones legacy en septiembre de 2027. */
export const HUBSPOT_API_VERSION = '2026-09';

/** Propietario asignado a los contactos creados. Vacío = sin asignar. */
export const HUBSPOT_OWNER_ID: string | undefined = undefined;

/** Valor de la propiedad `synckre_source` para los leads del agent. */
export const HUBSPOT_CONTACT_SOURCE = 'Synckre Agent';

/**
 * Objeto de citas. `appointments` es el nativo y está ACTIVO en el portal
 * (verificado). Un objeto personalizado usaría su objectTypeId `2-xxxxxxxx`.
 */
export const HUBSPOT_APPOINTMENT_OBJECT = 'appointments';

/** Tipo de asociación cita -> contacto. Verificado: 906 en el portal. */
export const HUBSPOT_APPOINTMENT_CONTACT_ASSOC_TYPE_ID = 906;

/** Tipo de asociación nota -> contacto. Verificado: 202 en el portal. */
export const HUBSPOT_NOTE_CONTACT_ASSOC_TYPE_ID = 202;

export const HUBSPOT_REQUEST_TIMEOUT_MS = 10_000;

export const HUBSPOT_MAX_RETRIES = 3;

/**
 * Caudal. El techo de una private app es 100 req/10 s en cuentas Free/Starter
 * (190 en Pro/Ent), y el endpoint de búsqueda tiene un límite propio de 5 req/s.
 */
export const HUBSPOT_MAX_RPS = 90;
export const HUBSPOT_SEARCH_MAX_RPS = 4;
