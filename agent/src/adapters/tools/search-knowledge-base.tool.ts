import { z } from 'zod';
import { IKnowledgeBase } from '@core/ports/knowledge-base.port';
import { ITool } from '@core/ports/tool.port';

const PUBLIC_TAG = 'public';

const inputSchema = z.object({
  query: z.string().min(1).describe('Search query about company services, processes or FAQs'),
});

export type SearchKnowledgeBaseInput = z.infer<typeof inputSchema>;

/**
 * RAG on-demand: el agente decide cuándo consultar documentos públicos.
 */
export class SearchKnowledgeBaseTool implements ITool {
  readonly name = 'search_knowledge_base';
  readonly description =
    'Search the public company knowledge base (services, processes, FAQs). Call this when the user asks about what the company does, how a process works, or similar factual questions. Do not call it on every turn.';
  readonly schema = inputSchema;

  constructor(private readonly knowledge: IKnowledgeBase) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message };
    }

    try {
      const chunks = await this.knowledge.search(parsed.data.query, [PUBLIC_TAG]);
      return {
        ok: true,
        chunks: chunks.map((chunk) => ({
          content: chunk.content,
          source: chunk.source,
          score: chunk.score,
        })),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Knowledge search failed' };
    }
  }
}
