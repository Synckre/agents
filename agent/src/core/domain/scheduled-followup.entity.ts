/**
 * Tipos y entidad de dominio para seguimiento y recordatorios programados.
 * 100% TypeScript puro: sin dependencias de infraestructura ni librerías externas.
 */

export type FollowupType = 'followup' | 'reminder';

export type FollowupAction = 'notify_human' | 'send_message' | 'send_template_email';

export type FollowupStatus = 'pending' | 'processing' | 'sent' | 'cancelled' | 'failed';

export type FollowupLanguage = 'es' | 'en';

export interface ScheduledFollowup {
  readonly id: string;
  readonly leadId: string;
  readonly conversationId: string;
  readonly dueAt: Date;
  readonly type: FollowupType;
  readonly action: FollowupAction;
  readonly context: string;
  readonly templateId?: string;
  readonly appointmentId?: string;
  readonly language: FollowupLanguage;
  readonly status: FollowupStatus;
  readonly retryCount: number;
  readonly claimedAt?: Date;
  readonly error?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
