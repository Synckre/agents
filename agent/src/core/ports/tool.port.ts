/**
 * Puerto que define la interfaz para la ejecución de herramientas externas por parte de los agentes.
 */
export interface ITool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
  execute(input: TInput): Promise<TOutput>;
}
