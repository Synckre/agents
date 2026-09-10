import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function isZodType(schema: unknown): schema is z.ZodType {
  return typeof schema === 'object' && schema !== null && '_def' in schema;
}

/**
 * Convierte un schema Zod (o un JSON Schema ya plano) a parámetros OpenAI/DeepSeek.
 */
export function toOpenAiParameters(schema: unknown): Record<string, unknown> {
  if (isZodType(schema)) {
    const json = zodToJsonSchema(schema, { $refStrategy: 'none' }) as Record<string, unknown>;
    delete json.$schema;
    if (!json.type) {
      json.type = 'object';
    }
    return json;
  }

  if (schema && typeof schema === 'object') {
    const copy = { ...(schema as Record<string, unknown>) };
    delete copy.$schema;
    return copy;
  }

  return { type: 'object', properties: {} };
}
