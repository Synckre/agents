import { ICrm, ILead, ILeadDraft, ILeadQuery } from '@core/ports/crm.port';

interface ErpNextDoc {
  name?: string;
  lead_name?: string;
  first_name?: string;
  email_id?: string;
  mobile_no?: string;
  phone?: string;
  status?: string;
  [key: string]: unknown;
}

interface ErpNextListResponse {
  data?: ErpNextDoc[];
}

interface ErpNextDocResponse {
  data?: ErpNextDoc;
}

function asLead(doc: ErpNextDoc): ILead {
  return {
    id: String(doc.name ?? ''),
    name: (doc.lead_name as string | undefined) ?? (doc.first_name as string | undefined),
    email: doc.email_id,
    phone: doc.mobile_no ?? doc.phone,
    data: doc,
  };
}

function toLeadFields(draft: ILeadDraft): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (draft.name) {
    fields.lead_name = draft.name;
    fields.first_name = draft.name;
  }
  if (draft.email) {
    fields.email_id = draft.email;
  }
  if (draft.phone) {
    fields.mobile_no = draft.phone;
  }
  if (draft.data) {
    const { notes, ...rest } = draft.data;
    Object.assign(fields, rest);
    if (typeof notes === 'string' && notes.trim().length > 0) {
      fields.notes = [{ note: notes.trim() }];
    } else if (Array.isArray(notes)) {
      fields.notes = notes;
    }
  }
  return fields;
}

/**
 * Cliente REST de ERPNext (Lead) con API key de privilegio mínimo.
 */
export class ErpNextAdapter implements ICrm {
  constructor(
    private readonly config: {
      baseUrl?: string;
      apiKey?: string;
      apiSecret?: string;
    },
  ) {}

  async findLead(query: ILeadQuery): Promise<ILead | null> {
    this.assertConfigured();
    const filters: Array<[string, string, string]> = [];
    if (query.email) {
      filters.push(['email_id', '=', query.email]);
    }
    if (query.phone) {
      filters.push(['mobile_no', '=', query.phone]);
    }
    if (filters.length === 0) {
      return null;
    }

    const byEmail = query.email
      ? await this.listLeads([['email_id', '=', query.email]])
      : [];
    if (byEmail[0]) {
      return byEmail[0];
    }

    if (query.phone) {
      const byPhone = await this.listLeads([['mobile_no', '=', query.phone]]);
      return byPhone[0] ?? null;
    }

    return null;
  }

  async getLeadById(id: string): Promise<ILead | null> {
    this.assertConfigured();
    const response = await this.request(`/api/resource/Lead/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`ERPNext getLead error (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as ErpNextDocResponse;
    return payload.data ? asLead(payload.data) : null;
  }

  async createLead(draft: ILeadDraft): Promise<ILead> {
    this.assertConfigured();
    const response = await this.request('/api/resource/Lead', {
      method: 'POST',
      body: JSON.stringify(toLeadFields(draft)),
    });
    if (!response.ok) {
      throw new Error(`ERPNext createLead error (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as ErpNextDocResponse;
    if (!payload.data) {
      throw new Error('ERPNext createLead returned an empty document');
    }
    return asLead(payload.data);
  }

  async updateLead(id: string, draft: ILeadDraft): Promise<ILead> {
    this.assertConfigured();
    const response = await this.request(`/api/resource/Lead/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(toLeadFields(draft)),
    });
    if (!response.ok) {
      throw new Error(`ERPNext updateLead error (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as ErpNextDocResponse;
    if (!payload.data) {
      throw new Error('ERPNext updateLead returned an empty document');
    }
    return asLead(payload.data);
  }

  async appendLeadNote(id: string, note: string): Promise<void> {
    this.assertConfigured();
    const cleanNote = note.trim();
    if (!cleanNote) return;

    const getRes = await this.request(`/api/resource/Lead/${encodeURIComponent(id)}`);
    if (!getRes.ok) {
      throw new Error(`ERPNext getLead error (${getRes.status}): ${await getRes.text()}`);
    }
    const doc = ((await getRes.json()) as ErpNextDocResponse).data;
    const existingNotes = Array.isArray(doc?.notes) ? (doc.notes as Array<{ note?: string }>) : [];
    const updatedNotes = [...existingNotes, { note: cleanNote }];

    const putRes = await this.request(`/api/resource/Lead/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ notes: updatedNotes }),
    });
    if (!putRes.ok) {
      throw new Error(`ERPNext appendLeadNote error (${putRes.status}): ${await putRes.text()}`);
    }
  }

  private async listLeads(filters: Array<[string, string, string]>): Promise<ILead[]> {
    const params = new URLSearchParams({
      filters: JSON.stringify(filters),
      fields: JSON.stringify(['name', 'lead_name', 'email_id', 'mobile_no', 'status']),
      limit_page_length: '5',
    });
    const response = await this.request(`/api/resource/Lead?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`ERPNext listLeads error (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as ErpNextListResponse;
    return (payload.data ?? []).map(asLead);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.config.baseUrl?.replace(/\/$/, '')}${path}`;
    // Timeout preventivo de 10 segundos para evitar bloqueos por latencia de red
    const signal = init.signal ?? AbortSignal.timeout(10_000);
    return fetch(url, {
      ...init,
      signal,
      headers: {
        Authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  private assertConfigured(): void {
    if (!this.config.baseUrl || !this.config.apiKey || !this.config.apiSecret) {
      throw new Error('ERPNext is not configured (ERPNEXT_URL / ERPNEXT_API_KEY / ERPNEXT_API_SECRET)');
    }
  }
}
