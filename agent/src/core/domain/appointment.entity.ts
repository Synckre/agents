/**
 * Entidad de dominio que representa una cita agendada en el sistema.
 */
export interface IBookedAppointment {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly title?: string;
  readonly attendeeName?: string;
  readonly attendeeEmail?: string;
  readonly meetLink?: string;
}
