import {
  IActivityNote,
  ICrm,
  ILead,
  ILeadDraft,
  ILeadQuery,
} from '@core/ports/crm.port';
import {
  IAppointmentRepository,
  IBookedAppointmentRecord,
  ICreateAppointmentRecord,
} from '@core/ports/appointment-repository.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { SchedulingPolicy } from '@core/domain/scheduling-policy';

/**
 * Combina el proveedor de política con un repositorio de citas, que es la forma
 * que consume la capa de tools (`schedulingPolicy` + `appointmentRepo`).
 */
export function combineScheduling(
  policy: ISchedulingPolicyProvider,
  repository: IAppointmentRepository,
): ISchedulingPolicyProvider & IAppointmentRepository {
  return {
    getPolicy: (): Promise<SchedulingPolicy> => policy.getPolicy(),
    findAppointments: (from, to) => repository.findAppointments(from, to),
    createAppointment: (input) => repository.createAppointment(input),
    cancelAppointment: (id) => repository.cancelAppointment(id),
    rescheduleAppointment: (id, time) => repository.rescheduleAppointment(id, time),
  };
}

/**
 * Decorador de CRM para el modo `dry_run`.
 *
 * Las lecturas atraviesan al adaptador real (para que la disponibilidad y el
 * contexto sigan siendo ciertos), pero las escrituras se registran y se
 * responden con identificadores sintéticos en lugar de tocar el CRM.
 *
 * Se usa en staging/QA y para validar el flujo completo sin contaminar el portal.
 */
/**
 * Prefijo de los identificadores sintéticos del modo dry_run. Se reconocen para
 * no enviarlos nunca al CRM real: un `dry-run-contact-1` enviado como id de
 * HubSpot produciría un 400 y rompería `search_lead` sobre el lead vinculado.
 */
export const DRY_RUN_ID_PREFIX = 'dry-run-';

export function isDryRunId(id: string): boolean {
  return id.startsWith(DRY_RUN_ID_PREFIX);
}

/** Últimos 10 dígitos de un teléfono, misma normalización que el adaptador real. */
function lastTenDigits(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return digits.length >= 7 ? digits : null;
  return digits.slice(-10);
}

export class DryRunCrmAdapter implements ICrm {
  private counter = 0;
  /** Contactos sintéticos creados, para que las lecturas posteriores los resuelvan. */
  private readonly synthetic = new Map<string, ILead>();

  constructor(
    private readonly inner: ICrm,
    private readonly logger: (message: string, meta?: Record<string, unknown>) => void = (message, meta) =>
      console.log(message, meta ?? ''),
  ) {}

  async findLead(query: ILeadQuery): Promise<ILead | null> {
    // Los contactos sintéticos son visibles para el flujo, pero el CRM real no
    // debe recibir búsquedas con datos que nunca persistimos.
    const synthetic = this.findSynthetic(query);
    if (synthetic) return synthetic;
    return this.inner.findLead(query);
  }

  async getLeadById(id: string): Promise<ILead | null> {
    if (isDryRunId(id)) {
      return this.synthetic.get(id) ?? null;
    }
    return this.inner.getLeadById(id);
  }

  async createLead(draft: ILeadDraft): Promise<ILead> {
    this.counter += 1;
    const id = `${DRY_RUN_ID_PREFIX}contact-${this.counter}`;
    this.logger('[crm:dry_run] createLead suppressed', { id, draft });
    const lead: ILead = {
      id,
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
      companyName: draft.companyName,
      jobTitle: draft.jobTitle,
      data: { dryRun: true },
    };
    this.synthetic.set(id, lead);
    return lead;
  }

  async updateLead(id: string, draft: ILeadDraft): Promise<ILead> {
    this.logger('[crm:dry_run] updateLead suppressed', { id, draft });
    const previous = this.synthetic.get(id);
    const lead: ILead = {
      id,
      name: draft.name ?? previous?.name,
      email: draft.email ?? previous?.email,
      phone: draft.phone ?? previous?.phone,
      companyName: draft.companyName ?? previous?.companyName,
      jobTitle: draft.jobTitle ?? previous?.jobTitle,
      data: { dryRun: true },
    };
    if (isDryRunId(id)) this.synthetic.set(id, lead);
    return lead;
  }

  /**
   * Busca en los contactos sintéticos por email o teléfono.
   * El teléfono se compara por los últimos 10 dígitos, igual que en el adaptador
   * real, para que un número con código de país encuentre a su contacto.
   */
  private findSynthetic(query: ILeadQuery): ILead | null {
    const email = query.email?.trim().toLowerCase();
    const phone = lastTenDigits(query.phone);
    for (const lead of this.synthetic.values()) {
      if (email && lead.email?.trim().toLowerCase() === email) return lead;
      if (phone && lastTenDigits(lead.phone) === phone) return lead;
    }
    return null;
  }

  async appendLeadNote(id: string, note: string | IActivityNote): Promise<void> {
    this.logger('[crm:dry_run] appendLeadNote suppressed', { id, note });
  }
}

/**
 * Decorador equivalente para el repositorio de citas. Conserva las lecturas
 * (necesarias para calcular disponibilidad) y silencia las escrituras.
 */
export class DryRunAppointmentRepository implements IAppointmentRepository {
  private counter = 0;
  /** Citas sintéticas creadas, para que cancelar/reprogramar las resuelvan. */
  private readonly synthetic = new Map<string, IBookedAppointmentRecord>();

  constructor(
    private readonly inner: IAppointmentRepository,
    private readonly logger: (message: string, meta?: Record<string, unknown>) => void = (message, meta) =>
      console.log(message, meta ?? ''),
  ) {}

  async findAppointments(from: Date | string, to: Date | string): Promise<IBookedAppointmentRecord[]> {
    return this.inner.findAppointments(from, to);
  }

  async createAppointment(input: ICreateAppointmentRecord): Promise<IBookedAppointmentRecord> {
    this.counter += 1;
    const id = `${DRY_RUN_ID_PREFIX}appointment-${this.counter}`;
    this.logger('[crm:dry_run] createAppointment suppressed', { id, input });
    const record: IBookedAppointmentRecord = {
      id,
      scheduledTime: input.scheduledTime,
      customerName: input.customerName,
      email: input.email,
      phone: input.phone,
      status: 'Scheduled',
      appointmentType: input.appointmentType,
      leadId: input.leadId,
      calendarEventId: input.calendarEventId,
      raw: { dryRun: true },
    };
    this.synthetic.set(id, record);
    return record;
  }

  async cancelAppointment(appointmentId: string): Promise<void> {
    this.logger('[crm:dry_run] cancelAppointment suppressed', { appointmentId });
    if (isDryRunId(appointmentId)) {
      const previous = this.synthetic.get(appointmentId);
      if (previous) this.synthetic.set(appointmentId, { ...previous, status: 'Canceled' });
    }
  }

  async rescheduleAppointment(
    appointmentId: string,
    newScheduledTime: string,
  ): Promise<IBookedAppointmentRecord> {
    this.logger('[crm:dry_run] rescheduleAppointment suppressed', { appointmentId, newScheduledTime });
    const previous = this.synthetic.get(appointmentId);
    const record: IBookedAppointmentRecord = {
      ...(previous ?? { customerName: '' }),
      id: appointmentId,
      scheduledTime: newScheduledTime,
      status: 'Scheduled',
      raw: { dryRun: true },
    };
    if (isDryRunId(appointmentId)) this.synthetic.set(appointmentId, record);
    return record;
  }
}
