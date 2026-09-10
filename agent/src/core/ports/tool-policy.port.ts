/**
 * Puerto que define la interfaz para políticas de seguridad transversales sobre herramientas.
 */
export interface IToolPolicy {
  readonly name: string;
  check(input: {
    toolName: string;
    conversationId: string;
    args: unknown;
  }): Promise<{ allowed: boolean; reason?: string }>;
}
