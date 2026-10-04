/**
 * Puerto de salida para el CRM (HubSpot): búsqueda y persistencia de leads/contactos
 * y notas de actividad.
 *
 * El puerto es deliberadamente agnóstico del proveedor: la capa de tools y los casos de uso
 * nunca conocen si detrás hay HubSpot, ERPNext u otro CRM.
 */

export interface ILeadQuery {
  readonly email?: string;
  readonly phone?: string;
}

export interface ILeadDraft {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly companyName?: string;
  readonly jobTitle?: string;
  readonly ownerId?: string;
  readonly source?: string;
  /**
   * Nota inicial a registrar en la actividad del contacto.
   * Se declara aquí y no en `data` porque es un dato de negocio real: un
   * adaptador que lo ignore pierde el contenido que el usuario escribió.
   */
  readonly notes?: string;
  /**
   * Campos específicos del proveedor. El adaptador decide cómo mapearlos,
   * así que solo debe usarse para datos que no tienen equivalente en el puerto.
   */
  readonly data?: Record<string, unknown>;
}

export interface ILead {
  readonly id: string;
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly companyName?: string;
  readonly jobTitle?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly data?: Record<string, unknown>;
}

/**
 * Motivo de fallo normalizado entre proveedores, para que la capa de tools pueda
 * decidir si reintenta o si debe reportar un error definitivo al usuario.
 */
export interface ICrmErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  /** Categoría tal como la reporta el proveedor (p. ej. HubSpot `VALIDATION_ERROR`). */
  readonly category?: string;
  readonly correlationId?: string;
  readonly retryable: boolean;
}

/**
 * Error de CRM normalizado. Los adaptadores deben lanzar siempre esta clase
 * (o una subclase) para que el manejo de errores sea uniforme.
 */
export class CrmError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly category?: string;
  readonly correlationId?: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(info: ICrmErrorInfo, details?: unknown) {
    super(info.message);
    this.name = 'CrmError';
    this.code = info.code;
    this.status = info.status;
    this.category = info.category;
    this.correlationId = info.correlationId;
    this.retryable = info.retryable;
    this.details = details;
  }
}

export interface IActivityNote {
  readonly body: string;
  /** Identificador lógico para agrupar notas de la misma conversación en el timeline del CRM. */
  readonly threadId?: string;
  readonly createdAt?: Date | string;
}

export interface ICrm {
  findLead(query: ILeadQuery): Promise<ILead | null>;
  getLeadById(id: string): Promise<ILead | null>;
  createLead(draft: ILeadDraft): Promise<ILead>;
  updateLead(id: string, draft: ILeadDraft): Promise<ILead>;
  appendLeadNote(id: string, note: string | IActivityNote): Promise<void>;
}

/**
 * Normaliza el parámetro de nota, que acepta tanto un string plano (contrato histórico)
 * como un objeto con metadatos de agrupación.
 */
export function normalizeActivityNote(note: string | IActivityNote): IActivityNote {
  if (typeof note === 'string') {
    return { body: note };
  }
  return { body: note.body ?? '', threadId: note.threadId, createdAt: note.createdAt };
}
