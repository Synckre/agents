/**
 * Entidad de dominio que representa una cita agendada en el sistema.
 */
export interface IBookedAppointment {
  /** Identificador del evento en el calendario (Google Calendar). */
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly title?: string;
  readonly attendeeName?: string;
  readonly attendeeEmail?: string;
  readonly meetLink?: string;
  /**
   * Identificador del registro espejo en el CRM, si se pudo persistir.
   *
   * Se guarda aquí para que cancelar o reprogramar no dependan de traducir el id
   * del calendario a un registro del CRM: esa traducción requiere propiedades
   * personalizadas que pueden no existir todavía en el portal.
   */
  readonly crmAppointmentId?: string;
}
