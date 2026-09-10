/**
 * Puerto de salida para generar embeddings (Ollama u otro proveedor local).
 */
export interface IEmbeddingProvider {
  embed(text: string): Promise<number[]>;
  dimensions(): number;
}
