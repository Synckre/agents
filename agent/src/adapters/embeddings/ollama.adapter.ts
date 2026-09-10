import { IEmbeddingProvider } from '@core/ports/embedding-provider.port';

interface OllamaEmbedResponse {
  embedding?: number[];
  embeddings?: number[][];
}

/**
 * Genera embeddings locales vía Ollama (`/api/embed` con fallback a `/api/embeddings`).
 */
export class OllamaEmbeddingAdapter implements IEmbeddingProvider {
  constructor(
    private readonly config: {
      baseUrl: string;
      model: string;
      dimensions: number;
    },
  ) {}

  dimensions(): number {
    return this.config.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const base = this.config.baseUrl.replace(/\/$/, '');

    const embedResponse = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, input: text }),
    });

    if (embedResponse.ok) {
      const payload = (await embedResponse.json()) as OllamaEmbedResponse;
      const vector = payload.embeddings?.[0] ?? payload.embedding;
      if (vector) {
        return vector;
      }
    }

    const legacy = await fetch(`${base}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: text }),
    });

    if (!legacy.ok) {
      const errorText = await legacy.text();
      throw new Error(`Ollama embeddings error (${legacy.status}): ${errorText}`);
    }

    const payload = (await legacy.json()) as OllamaEmbedResponse;
    const vector = payload.embedding ?? payload.embeddings?.[0];
    if (!vector) {
      throw new Error('Ollama embeddings response did not include a vector');
    }
    return vector;
  }
}
