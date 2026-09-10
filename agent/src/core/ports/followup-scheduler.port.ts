import { ScheduledFollowup } from '@core/domain/scheduled-followup.entity';

export interface ScheduleFollowupInput {
  readonly leadId: string;
  readonly conversationId: string;
  readonly dueAt: Date;
  readonly type: ScheduledFollowup['type'];
  readonly action: ScheduledFollowup['action'];
  readonly context: string;
  readonly templateId?: string;
  readonly appointmentId?: string;
  readonly language?: ScheduledFollowup['language'];
}

/**
 * Puerto de salida (driven port) para la programación y gestión de seguimientos/recordatorios.
 */
export interface IFollowupScheduler {
  schedule(input: ScheduleFollowupInput): Promise<string>;
  findDue(now: Date, limit: number, staleMinutes: number): Promise<ScheduledFollowup[]>;
  claimForProcessing(id: string, staleMinutes: number): Promise<boolean>;
  markAsSent(id: string): Promise<void>;
  markAsFailed(id: string, reason: string, maxRetries: number): Promise<void>;
  cancel(id: string): Promise<void>;
  cancelByAppointmentId(appointmentId: string): Promise<void>;
}
