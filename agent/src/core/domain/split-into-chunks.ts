export interface SplitIntoChunksOptions {
  readonly chunkSize?: number;
  readonly maxTokens?: number;
  readonly overlap?: number;
}

/**
 * Divide un texto en fragmentos (chunks) preservando límites de párrafos y oraciones,
 * con solapamiento configurable para mantener el contexto entre chunks continuos.
 *
 * Utilidad de dominio pura, sin dependencias de infraestructura ni adapters.
 */
export function splitIntoChunks(
  text: string,
  options: SplitIntoChunksOptions = {},
): string[] {
  // Si se especifica maxTokens se aproxima en caracteres (~4 caracteres por token)
  const chunkSize = options.chunkSize ?? (options.maxTokens ? options.maxTokens * 4 : 1200);
  const overlap = options.overlap ?? 200;

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  // Descomponer en párrafos
  const rawParagraphs = normalized.split(/\n{2,}/);
  const paragraphs: string[] = [];

  // Si un párrafo individual es más largo que el chunkSize, subdividirlo por oraciones
  for (const p of rawParagraphs) {
    const trimmedP = p.trim();
    if (!trimmedP) continue;

    if (trimmedP.length > chunkSize) {
      const sentences = trimmedP.split(/(?<=[.!?])\s+/);
      let sentenceBuffer = '';
      for (const sentence of sentences) {
        if ((sentenceBuffer + ' ' + sentence).trim().length > chunkSize && sentenceBuffer) {
          paragraphs.push(sentenceBuffer.trim());
          sentenceBuffer = sentence;
        } else {
          sentenceBuffer = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
        }
      }
      if (sentenceBuffer.trim()) {
        paragraphs.push(sentenceBuffer.trim());
      }
    } else {
      paragraphs.push(trimmedP);
    }
  }

  const chunks: string[] = [];
  let buffer = '';

  const flush = (): void => {
    const piece = buffer.trim();
    if (piece) {
      chunks.push(piece);
    }
    buffer = overlap > 0 && piece.length > overlap ? piece.slice(-overlap) : '';
  };

  for (const paragraph of paragraphs) {
    if ((buffer + '\n\n' + paragraph).length > chunkSize && buffer) {
      flush();
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();

  return chunks;
}
