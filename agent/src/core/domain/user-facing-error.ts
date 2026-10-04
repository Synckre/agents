/**
 * Error cuyo mensaje SÍ puede mostrarse al usuario final.
 *
 * Los mensajes de error de la infraestructura (CRM, correo, base de datos) suelen
 * contener detalles de implementación —nombres de variables de entorno, endpoints,
 * pasos de diagnóstico— que un visitante del sitio no debe ver. La capa de tools
 * devuelve sus mensajes al modelo, y el modelo los explica al usuario, así que hace
 * falta distinguir de forma explícita qué texto es apto para el público.
 *
 * Todo lo que NO sea `UserFacingError` se sustituye por un mensaje neutro antes de
 * llegar al modelo; el detalle se registra en los logs del servidor.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

/** ¿El mensaje de este error es apto para mostrarse al usuario? */
export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}
