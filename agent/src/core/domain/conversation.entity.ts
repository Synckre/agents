import { IBookedAppointment } from './appointment.entity';
import { IMessage } from './message.value-object';

export type ConversationStatus = 'active' | 'paused_for_human';

export const PAUSED_FOR_HUMAN: ConversationStatus = 'paused_for_human';

export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const PHONE_REGEX = /(?:\+?\s*)?(?:\(\s*\d{1,4}\s*\)|\d{1,4})[\d\s\-.()]{4,18}\d/g;
export const NAME_INTRO_REGEX = /(?:me llamo|mi nombre es|soy|nombre:\s*|i am|my name is|i'm)\s+([A-ZÁÉÍÓÚÑa-záéíóúñü'\s]+)/i;

/**
 * Entidad central que representa el estado y ciclo de vida de una conversación multi-agente.
 */
export interface IConversation {
  readonly id: string;
  readonly messages: readonly IMessage[];
  readonly currentAgent?: string;
  readonly metadata?: Record<string, unknown>;
  readonly status?: ConversationStatus;
}

export const CONVERSATION_META = {
  status: 'status',
  leadId: 'leadId',
  allowedEmails: 'allowedEmails',
  appointmentCount: 'appointmentCount',
  bookedAppointments: 'bookedAppointments',
  sessionTokenHash: 'sessionTokenHash',
} as const;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPausedForHuman(conversation: IConversation | null | undefined): boolean {
  if (!conversation) {
    return false;
  }
  if (conversation.status === PAUSED_FOR_HUMAN) {
    return true;
  }
  return conversation.metadata?.[CONVERSATION_META.status] === PAUSED_FOR_HUMAN;
}

/**
 * Entidad de conversación con transiciones de estado explícitas y Aggregate Root en DDD.
 */
export class Conversation implements IConversation {
  readonly id: string;
  readonly messages: readonly IMessage[];
  readonly currentAgent?: string;
  readonly metadata?: Record<string, unknown>;
  readonly status: ConversationStatus;

  constructor(params: IConversation) {
    this.id = params.id;
    this.messages = params.messages;
    this.currentAgent = params.currentAgent;
    this.metadata = params.metadata;
    this.status =
      params.status ??
      (params.metadata?.[CONVERSATION_META.status] === PAUSED_FOR_HUMAN
        ? PAUSED_FOR_HUMAN
        : 'active');
  }

  static from(params: IConversation): Conversation {
    return params instanceof Conversation ? params : new Conversation(params);
  }

  pauseForHuman(): Conversation {
    return new Conversation({
      id: this.id,
      messages: this.messages,
      currentAgent: this.currentAgent,
      metadata: { ...this.metadata, [CONVERSATION_META.status]: PAUSED_FOR_HUMAN },
      status: PAUSED_FOR_HUMAN,
    });
  }

  withMetadata(patch: Record<string, unknown>): Conversation {
    return new Conversation({
      id: this.id,
      messages: this.messages,
      currentAgent: this.currentAgent,
      metadata: { ...this.metadata, ...patch },
      status: this.status,
    });
  }

  withMessages(messages: readonly IMessage[]): Conversation {
    return new Conversation({
      id: this.id,
      messages,
      currentAgent: this.currentAgent,
      metadata: this.metadata,
      status: this.status,
    });
  }

  // --- MÉTODOS DE DOMINIO: LEADS ---

  getBoundLeadId(): string | undefined {
    const value = this.metadata?.[CONVERSATION_META.leadId];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  bindLead(leadId: string): Conversation {
    return this.withMetadata({ [CONVERSATION_META.leadId]: leadId });
  }

  // --- MÉTODOS DE DOMINIO: EMAILS ---

  getAllowedEmails(): string[] {
    return asStringArray(this.metadata?.[CONVERSATION_META.allowedEmails]).map(normalizeEmail);
  }

  registerEmails(emails: Array<string | undefined>): Conversation {
    const incoming = emails
      .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
      .map(normalizeEmail);

    if (incoming.length === 0) {
      return this;
    }

    const merged = Array.from(new Set([...this.getAllowedEmails(), ...incoming]));
    return this.withMetadata({ [CONVERSATION_META.allowedEmails]: merged });
  }

  isAllowedEmail(email: string): boolean {
    return this.getAllowedEmails().includes(normalizeEmail(email));
  }

  extractLiteralEmail(candidateEmail?: string): string | undefined {
    const userMessages = [...this.messages]
      .filter((m) => m.role === 'user')
      .reverse();

    const foundEmails: string[] = [];
    for (const msg of userMessages) {
      const matches = msg.content.match(EMAIL_REGEX);
      if (matches) {
        foundEmails.push(...matches);
      }
    }

    if (foundEmails.length === 0) {
      return candidateEmail;
    }

    if (!candidateEmail) {
      return foundEmails[0];
    }

    const normCandidate = candidateEmail.trim().toLowerCase();
    const exact = foundEmails.find((e) => e.trim().toLowerCase() === normCandidate);
    if (exact) return exact;

    const [candidateLocal, candidateDomain] = normCandidate.split('@');
    const similar = foundEmails.find((e) => {
      const [local, domain] = e.trim().toLowerCase().split('@');
      if (domain === candidateDomain && candidateLocal && local) {
        return local.startsWith(candidateLocal) || candidateLocal.startsWith(local);
      }
      return false;
    });

    if (similar) {
      return similar;
    }

    if (foundEmails.length === 1) {
      return foundEmails[0];
    }

    return candidateEmail;
  }

  extractLiteralPhone(candidatePhone?: string): string | undefined {
    const userMessages = [...this.messages]
      .filter((m) => m.role === 'user')
      .reverse();

    const foundPhones: string[] = [];
    for (const msg of userMessages) {
      const matches = msg.content.match(PHONE_REGEX);
      if (matches) {
        for (const m of matches) {
          const digits = m.replace(/\D/g, '');
          if (digits.length >= 7 && digits.length <= 15) {
            foundPhones.push(m.trim());
          }
        }
      }
    }

    if (foundPhones.length === 0) {
      return candidatePhone;
    }

    if (!candidatePhone) {
      return foundPhones[0];
    }

    const candDigits = candidatePhone.replace(/\D/g, '');
    if (!candDigits) {
      return foundPhones[0];
    }

    // Coincidencia exacta de dígitos
    const exact = foundPhones.find((p) => p.replace(/\D/g, '') === candDigits);
    if (exact) return exact;

    // Coincidencia por prefijo/sufijo (ej: con o sin código de país)
    const suffixMatch = foundPhones.find((p) => {
      const d = p.replace(/\D/g, '');
      return d.endsWith(candDigits) || candDigits.endsWith(d);
    });
    if (suffixMatch) return suffixMatch;

    if (foundPhones.length === 1 && candDigits.length >= 6) {
      return foundPhones[0];
    }

    return candidatePhone;
  }

  extractLiteralName(candidateName?: string): string | undefined {
    const userMessages = [...this.messages]
      .filter((m) => m.role === 'user')
      .reverse();

    if (!candidateName) {
      for (const msg of userMessages) {
        const match = msg.content.match(NAME_INTRO_REGEX);
        if (match && match[1]) {
          const words = match[1]
            .replace(/\s+(?:y|and|para|for|de|con|que|mi|my|quiero|want|here|a\b|[.,!?]).*$/i, '')
            .trim()
            .split(/\s+/);
          return words.slice(0, 3).join(' ');
        }
      }
      return undefined;
    }

    const normCandidate = candidateName.trim().toLowerCase();

    // 1. Si la cadena exacta aparece en el mensaje del usuario, recuperar la versión literal del usuario
    for (const msg of userMessages) {
      const idx = msg.content.toLowerCase().indexOf(normCandidate);
      if (idx !== -1) {
        return msg.content.slice(idx, idx + candidateName.trim().length);
      }
    }

    // 2. Si el usuario usó una frase de presentación ("me llamo X", "soy X")
    for (const msg of userMessages) {
      const match = msg.content.match(NAME_INTRO_REGEX);
      if (match && match[1]) {
        const rawIntro = match[1]
          .replace(/\s+(?:y|and|para|for|de|con|que|mi|my|quiero|want|here|a\b|[.,!?]).*$/i, '')
          .trim();
        const candParts = normCandidate.split(/\s+/).filter(Boolean);
        const introWords = rawIntro.split(/\s+/).filter(Boolean);

        if (introWords.length > 0 && candParts.length > 0) {
          const candidateLength = candParts.length;
          const candidateWords = introWords.slice(0, candidateLength).join(' ');

          const firstIntro = introWords[0].toLowerCase();
          const firstCand = candParts[0].toLowerCase();
          if (
            firstIntro === firstCand ||
            firstCand.startsWith(firstIntro.slice(0, 3)) ||
            firstIntro.startsWith(firstCand.slice(0, 3))
          ) {
            return candidateWords;
          }
        }
      }
    }

    return candidateName;
  }

  // --- MÉTODOS DE DOMINIO: CITAS ---

  getAppointmentCount(): number {
    const value = this.metadata?.[CONVERSATION_META.appointmentCount];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  incrementAppointmentCount(): Conversation {
    return this.withMetadata({
      [CONVERSATION_META.appointmentCount]: this.getAppointmentCount() + 1,
    });
  }

  getBookedAppointments(): IBookedAppointment[] {
    const value = this.metadata?.[CONVERSATION_META.bookedAppointments];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(
      (item): item is IBookedAppointment =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as IBookedAppointment).id === 'string',
    );
  }

  recordAppointment(appointment: IBookedAppointment): Conversation {
    const existing = this.getBookedAppointments().filter((a) => a.id !== appointment.id);
    return this.withMetadata({
      [CONVERSATION_META.bookedAppointments]: [...existing, appointment],
      [CONVERSATION_META.appointmentCount]: this.getAppointmentCount() + 1,
    });
  }

  updateAppointment(
    appointmentId: string,
    patchData: Partial<IBookedAppointment>,
  ): Conversation {
    const list = this.getBookedAppointments().map((a) => {
      if (a.id === appointmentId) {
        return { ...a, ...patchData };
      }
      return a;
    });
    return this.withMetadata({
      [CONVERSATION_META.bookedAppointments]: list,
    });
  }

  cancelAppointment(appointmentId: string): Conversation {
    const current = this.getBookedAppointments();
    const next = current.filter((a) => a.id !== appointmentId);
    const count = this.getAppointmentCount();
    return this.withMetadata({
      [CONVERSATION_META.bookedAppointments]: next,
      [CONVERSATION_META.appointmentCount]: Math.max(0, count - 1),
    });
  }

  toJSON(): IConversation {
    return {
      id: this.id,
      messages: this.messages,
      currentAgent: this.currentAgent,
      metadata: this.metadata,
      status: this.status,
    };
  }
}
