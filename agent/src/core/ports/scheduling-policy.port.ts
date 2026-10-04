import { SchedulingPolicy } from '@core/domain/scheduling-policy';

/**
 * Puerto para obtener y actualizar la política de disponibilidad y horarios comerciales.
 * Se implementa con configuración estática (variables de entorno), con base de datos
 * o con cualquier proveedor remoto.
 */
export interface ISchedulingPolicyProvider {
  /**
   * Retorna la política de agendamiento vigente.
   */
  getPolicy(): Promise<SchedulingPolicy>;
}
