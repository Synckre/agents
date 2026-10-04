import { CrmError } from '@core/ports/crm.port';
import { isUserFacingError } from '@core/domain/user-facing-error';

/**
 * Convierte un error interno en un mensaje seguro para el usuario.
 *
 * El resultado se le devuelve al modelo, que lo explicará en el idioma del usuario.
 * Por eso NUNCA debe contener detalles de implementación: nombres de variables de
 * entorno, endpoints, códigos de estado ni pasos de diagnóstico internos.
 *
 * Los errores marcados como `UserFacingError` (validaciones, por ejemplo "no se
 * puede reservar en el pasado") se propagan tal cual, porque sí ayudan al usuario.
 */
export function safeToolError(error: unknown, fallback: string): string {
  if (isUserFacingError(error)) {
    return error.message;
  }

  if (error instanceof CrmError) {
    // Se distingue sólo lo que cambia lo que el usuario puede hacer; el resto de
    // detalles (código, scopes, correlationId) se quedan en los logs.
    switch (error.code) {
      case 'CRM_RATE_LIMITED':
        return 'The system is receiving too many requests right now. Please try again in a few seconds.';
      case 'CRM_VALIDATION_ERROR':
        return 'Some of the provided details could not be stored. Please check them and try again.';
      default:
        return 'The CRM is temporarily unavailable, so the data could not be saved.';
    }
  }

  return fallback;
}
