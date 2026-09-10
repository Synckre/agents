import { describe, expect, it } from 'vitest';
import { splitIntoChunks } from '@core/domain/split-into-chunks';

describe('splitIntoChunks (Domain Utility)', () => {
  it('devuelve array vacío ante texto vacío o solo espacios', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   \n\n  \t  ')).toEqual([]);
  });

  it('mantiene texto corto en un único chunk', () => {
    const text = 'Este es un texto corto que cabe holgadamente en un chunk.';
    const chunks = splitIntoChunks(text, { chunkSize: 200, overlap: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('divide párrafos cuando superan el chunkSize respetando el límite', () => {
    const p1 = 'Párrafo 1: ' + 'A'.repeat(80);
    const p2 = 'Párrafo 2: ' + 'B'.repeat(80);
    const p3 = 'Párrafo 3: ' + 'C'.repeat(80);
    const fullText = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = splitIntoChunks(fullText, { chunkSize: 120, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(180);
    }
  });

  it('aplica solapamiento (overlap) entre chunks consecutivos', () => {
    const p1 = 'Primera sección con contenido relevante sobre productos de Synckre.';
    const p2 = 'Segunda sección con detalles sobre precios y planes empresariales.';
    const text = `${p1}\n\n${p2}`;

    const chunks = splitIntoChunks(text, { chunkSize: 75, overlap: 25 });
    expect(chunks.length).toBeGreaterThan(1);

    // El segundo chunk debe incluir parte del final del primero por el overlap
    const tailOfFirst = p1.slice(-20);
    expect(chunks[1]).toContain(tailOfFirst);
  });

  it('subdivide oraciones cuando un solo párrafo excede ampliamente el chunkSize', () => {
    const sentence1 = 'Oración 1: ' + 'X'.repeat(60) + '.';
    const sentence2 = 'Oración 2: ' + 'Y'.repeat(60) + '.';
    const giantParagraph = `${sentence1} ${sentence2}`;

    const chunks = splitIntoChunks(giantParagraph, { chunkSize: 80, overlap: 20 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('Oración 1:');
    expect(chunks[1]).toContain('Oración 2:');
  });
});
