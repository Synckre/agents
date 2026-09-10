export interface IBookedAppointmentRecord {
  readonly id: string;
  readonly scheduledTime: string;
  readonly customerName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly status: string;
  readonly appointmentType?: string;
  readonly leadId?: string;
  readonly calendarEventId?: string;
  readonly raw?: unknown;
}

export interface ICreateAppointmentRecord {
  readonly scheduledTime: string;
  readonly customerName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly appointmentType?: string;
  readonly leadId?: string;
  readonly calendarEventId?: string;
  readonly notes?: string;
}

/**
 * Puerto para persistir y consultar citas en el CRM / sistema de registro (ERPNext DocType Appointment).
 */
export interface IAppointmentRepository {
  findAppointments(from: Date | string, to: Date | string): Promise<IBookedAppointmentRecord[]>;
  createAppointment(input: ICreateAppointmentRecord): Promise<IBookedAppointmentRecord>;
  cancelAppointment(appointmentId: string): Promise<void>;
  rescheduleAppointment(
    appointmentId: string,
    newScheduledTime: string,
  ): Promise<IBookedAppointmentRecord>;
}
