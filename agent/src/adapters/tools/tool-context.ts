import { IAgentState } from '@core/domain/agent-state';
import { IBookedAppointment } from '@core/domain/appointment.entity';
import { Conversation, IConversation } from '@core/domain/conversation.entity';
import { IMemoryStore } from '@core/ports/memory-store.port';

export type { IBookedAppointment };

/**
 * Contexto de ejecución inyectado a las herramientas del agente.
 */
export interface IToolContext {
  readonly conversationId: string;
  readonly maxAppointments: number;
  getState(): IAgentState;
  memory: IMemoryStore;
  session?: ConversationSession;
}

/**
 * Gestor de sesión de conversación para herramientas.
 * Mantiene una caché en memoria por turno para evitar lecturas redundantes a Postgres.
 */
export class ConversationSession {
  private cached: Conversation | null = null;

  constructor(private readonly ctx: IToolContext) {}

  async get(): Promise<Conversation> {
    // Si ya se cargó en este turno, retorna directamente de RAM (0ms)
    if (this.cached) {
      return this.cached;
    }

    const existing = await this.ctx.memory.getById(this.ctx.conversationId);
    if (existing) {
      this.cached = Conversation.from(existing);
      return this.cached;
    }

    const state = this.ctx.getState();
    const created = new Conversation({
      id: this.ctx.conversationId,
      messages: state.messages,
      currentAgent: state.currentAgent,
      metadata: state.metadata,
      status: 'active',
    });
    await this.ctx.memory.save(created);
    this.cached = created;
    return created;
  }

  async mutate(updater: (conversation: Conversation) => Conversation): Promise<Conversation> {
    const current = await this.get();
    const next = updater(current);
    this.cached = next;
    await this.ctx.memory.save(next);
    return next;
  }
}

// --- HELPERS DE ACCESO COMPATIBLES (delegan en el Aggregate Root Conversation) ---

function getSession(ctx: IToolContext): ConversationSession {
  if (ctx.session) {
    return ctx.session;
  }
  return new ConversationSession(ctx);
}

export async function loadConversation(ctx: IToolContext): Promise<Conversation> {
  return getSession(ctx).get();
}

export async function patchConversation(
  ctx: IToolContext,
  patch: (conversation: Conversation) => Conversation,
): Promise<Conversation> {
  return getSession(ctx).mutate(patch);
}

export function getBoundLeadId(conversation: IConversation): string | undefined {
  return Conversation.from(conversation).getBoundLeadId();
}

export function getAllowedEmails(conversation: IConversation): string[] {
  return Conversation.from(conversation).getAllowedEmails();
}

export function isAllowedEmail(conversation: IConversation, email: string): boolean {
  return Conversation.from(conversation).isAllowedEmail(email);
}

export function getAppointmentCount(conversation: IConversation): number {
  return Conversation.from(conversation).getAppointmentCount();
}

export function getBookedAppointments(conversation: IConversation): IBookedAppointment[] {
  return Conversation.from(conversation).getBookedAppointments();
}

export async function bindLead(ctx: IToolContext, leadId: string): Promise<void> {
  await patchConversation(ctx, (conversation) => conversation.bindLead(leadId));
}

export async function registerEmails(
  ctx: IToolContext,
  emails: Array<string | undefined>,
): Promise<string[]> {
  const updated = await patchConversation(ctx, (conversation) => conversation.registerEmails(emails));
  return updated.getAllowedEmails();
}

export async function incrementAppointmentCount(ctx: IToolContext): Promise<number> {
  const updated = await patchConversation(ctx, (conversation) => conversation.incrementAppointmentCount());
  return updated.getAppointmentCount();
}

export function extractLiteralEmailFromMessages(
  conversation: IConversation,
  candidateEmail?: string,
): string | undefined {
  return Conversation.from(conversation).extractLiteralEmail(candidateEmail);
}

export function extractLiteralPhoneFromMessages(
  conversation: IConversation,
  candidatePhone?: string,
): string | undefined {
  return Conversation.from(conversation).extractLiteralPhone(candidatePhone);
}

export function extractLiteralNameFromMessages(
  conversation: IConversation,
  candidateName?: string,
): string | undefined {
  return Conversation.from(conversation).extractLiteralName(candidateName);
}

export async function recordBookedAppointment(
  ctx: IToolContext,
  appointment: IBookedAppointment,
): Promise<IBookedAppointment[]> {
  const updated = await patchConversation(ctx, (conversation) => conversation.recordAppointment(appointment));
  return updated.getBookedAppointments();
}

export async function updateBookedAppointment(
  ctx: IToolContext,
  appointmentId: string,
  patchData: Partial<IBookedAppointment>,
): Promise<IBookedAppointment | null> {
  let updatedApp: IBookedAppointment | null = null;
  await patchConversation(ctx, (conversation) => {
    const updated = conversation.updateAppointment(appointmentId, patchData);
    updatedApp = updated.getBookedAppointments().find((a) => a.id === appointmentId) ?? null;
    return updated;
  });
  return updatedApp;
}

export async function removeBookedAppointment(
  ctx: IToolContext,
  appointmentId: string,
): Promise<boolean> {
  const before = await loadConversation(ctx);
  const hadIt = before.getBookedAppointments().some((a) => a.id === appointmentId);
  if (hadIt) {
    await patchConversation(ctx, (conversation) => conversation.cancelAppointment(appointmentId));
  }
  return hadIt;
}
