/**
 * Puerto de salida para el CRM (ERPNext): búsqueda y persistencia de leads/contactos.
 */
export interface ILeadQuery {
  readonly email?: string;
  readonly phone?: string;
}

export interface ILeadDraft {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly data?: Record<string, unknown>;
}

export interface ILead {
  readonly id: string;
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly data?: Record<string, unknown>;
}

export interface ICrm {
  findLead(query: ILeadQuery): Promise<ILead | null>;
  getLeadById(id: string): Promise<ILead | null>;
  createLead(draft: ILeadDraft): Promise<ILead>;
  updateLead(id: string, draft: ILeadDraft): Promise<ILead>;
  appendLeadNote(id: string, note: string): Promise<void>;
}
