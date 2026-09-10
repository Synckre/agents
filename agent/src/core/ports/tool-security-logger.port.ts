/**
 * Representa una entrada de auditoría de seguridad tras la evaluación de una herramienta.
 */
export interface ToolSecurityLogEntry {
  readonly toolName: string;
  readonly conversationId: string;
  readonly allowed: boolean;
  readonly reason?: string;
  readonly args?: unknown;
  readonly timestamp?: Date;
}

/**
 * Puerto para la persistencia y auditoría de eventos de seguridad de herramientas.
 */
export interface IToolSecurityLogger {
  log(entry: ToolSecurityLogEntry): Promise<void> | void;
}
