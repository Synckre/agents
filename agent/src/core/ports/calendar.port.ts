/**
 * Puerto de salida para disponibilidad y agendado (Google Calendar).
 */
export interface ITimeRange {
  readonly start: string;
  readonly end: string;
}

export type ITimeSlot = ITimeRange;

export interface ICreateAppointmentInput extends ITimeRange {
  readonly attendeeName: string;
  readonly attendeeEmail?: string;
  readonly title?: string;
  readonly notes?: string;
}

export interface IAppointment extends ITimeRange {
  readonly id: string;
  readonly attendeeName: string;
  readonly attendeeEmail?: string;
  readonly title?: string;
  readonly meetLink?: string;
}

export interface ICalendar {
  listBusyBlocks?(range: ITimeRange): Promise<ITimeRange[]>;
  findAvailability(range: ITimeRange, slotMinutes?: number): Promise<ITimeSlot[]>;
  createAppointment(input: ICreateAppointmentInput): Promise<IAppointment>;
  rescheduleAppointment(appointmentId: string, range: ITimeRange): Promise<IAppointment>;
  cancelAppointment(appointmentId: string): Promise<void>;
}
