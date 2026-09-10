/**
 * Puerto de salida para el envío de correo transaccional (Resend u otro proveedor).
 */
export interface IEmailAttachment {
  readonly filename: string;
  readonly content: string; // Base64 or string content
  readonly contentType?: string;
}

export interface IEmailMessage {
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly from?: string;
  readonly templateId: string;
  readonly variables?: Record<string, unknown>;
  readonly attachments?: readonly IEmailAttachment[];
}

export interface IEmailSender {
  send(message: IEmailMessage): Promise<{ id: string }>;
}
