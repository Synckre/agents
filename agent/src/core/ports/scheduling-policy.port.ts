import { SchedulingPolicy } from '@core/domain/scheduling-policy';

/**
 * Puerto para obtener y actualizar la política de disponibilidad y horarios comerciales.
 * Puede implementarse leyendo de ERPNext (Appointment Booking Settings + Holiday List),
 * de base de datos o de configuración estática.
 */
export interface ISchedulingPolicyProvider {
  /**
   * Retorna la política de agendamiento vigente.
   */
  getPolicy(): Promise<SchedulingPolicy>;
}
