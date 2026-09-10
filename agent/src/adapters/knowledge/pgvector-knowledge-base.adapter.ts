import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { IEmbeddingProvider } from '@core/ports/embedding-provider.port';
import {
  IKnowledgeBase,
  KnowledgeChunk,
  KnowledgeSourceRecord,
  SaveKnowledgeSourceInput,
} from '@core/ports/knowledge-base.port';
import { KNOWLEDGE_HNSW_INDEX_SQL, POSTGRES_SCHEMA_SQL } from '@adapters/persistence/postgres-schema';

interface KnowledgeRow {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  score: number | string | null;
}

export interface KnowledgeRecord {
  readonly content: string;
  readonly source?: string;
  readonly tags: string[];
  readonly embedding: number[];
  readonly id?: string;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

/**
 * Búsqueda semántica: embedding de la query con Ollama + k-NN en pgvector.
 */
export class PgVectorKnowledgeBase implements IKnowledgeBase {
  private ready: Promise<void> | null = null;
  // Caché en memoria de embeddings para acelerar búsquedas frecuentes (0ms)
  private readonly queryEmbeddingCache = new Map<string, number[]>();
  private readonly maxCacheEntries = 200;

  constructor(
    private readonly pool: Pool,
    private readonly embeddings: IEmbeddingProvider,
    private readonly options: { defaultLimit?: number } = {},
  ) {}

  private async getEmbedding(query: string): Promise<number[]> {
    const normalized = query.trim().toLowerCase();
    const cached = this.queryEmbeddingCache.get(normalized);
    if (cached) {
      return cached;
    }

    const embedding = await this.embeddings.embed(query);
    if (this.queryEmbeddingCache.size >= this.maxCacheEntries) {
      const firstKey = this.queryEmbeddingCache.keys().next().value;
      if (firstKey) this.queryEmbeddingCache.delete(firstKey);
    }
    this.queryEmbeddingCache.set(normalized, embedding);
    return embedding;
  }

  async search(query: string, tags?: string[]): Promise<KnowledgeChunk[]> {
    await this.ensureSchema();
    const embedding = await this.getEmbedding(query);
    const limit = this.options.defaultLimit ?? 6;
    const vector = toVectorLiteral(embedding);

    const result = tags && tags.length > 0
      ? await this.pool.query<KnowledgeRow>(
          `SELECT id, content, source, tags,
                  1 - (embedding <=> $1::vector) AS score
           FROM knowledge_chunks
           WHERE tags @> $2::text[]
           ORDER BY embedding <=> $1::vector
           LIMIT $3`,
          [vector, tags, limit],
        )
      : await this.pool.query<KnowledgeRow>(
          `SELECT id, content, source, tags,
                  1 - (embedding <=> $1::vector) AS score
           FROM knowledge_chunks
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [vector, limit],
        );

    return result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      source: row.source ?? undefined,
      tags: row.tags ?? [],
      score: row.score === null ? undefined : Number(row.score),
    }));
  }

  async upsert(records: readonly KnowledgeRecord[]): Promise<number> {
    await this.ensureSchema();
    let count = 0;
    for (const record of records) {
      await this.pool.query(
        `INSERT INTO knowledge_chunks (id, content, embedding, source, tags)
         VALUES ($1, $2, $3::vector, $4, $5::text[])
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           embedding = EXCLUDED.embedding,
           source = EXCLUDED.source,
           tags = EXCLUDED.tags`,
        [
          record.id ?? randomUUID(),
          record.content,
          toVectorLiteral(record.embedding),
          record.source ?? null,
          record.tags,
        ],
      );
      count += 1;
    }
    return count;
  }

  async deleteBySourceId(sourceId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('DELETE FROM knowledge_chunks WHERE source = $1', [sourceId]);
  }

  async insertChunks(
    sourceId: string,
    chunks: Array<{ content: string; embedding: number[]; tags: string[] }>,
  ): Promise<void> {
    await this.ensureSchema();
    for (const chunk of chunks) {
      await this.pool.query(
        `INSERT INTO knowledge_chunks (id, content, embedding, source, tags)
         VALUES ($1, $2, $3::vector, $4, $5::text[])`,
        [
          randomUUID(),
          chunk.content,
          toVectorLiteral(chunk.embedding),
          sourceId,
          chunk.tags,
        ],
      );
    }
  }

  async getSource(sourceId: string): Promise<KnowledgeSourceRecord | null> {
    await this.ensureSchema();
    const res = await this.pool.query<{
      source_id: string;
      name: string;
      tags: string[];
      drive_modified_time: Date;
      last_synced_at: Date;
      status: 'active' | 'deleted';
    }>(
      'SELECT source_id, name, tags, drive_modified_time, last_synced_at, status FROM knowledge_sources WHERE source_id = $1',
      [sourceId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      sourceId: row.source_id,
      name: row.name,
      tags: row.tags,
      driveModifiedTime: new Date(row.drive_modified_time),
      lastSyncedAt: new Date(row.last_synced_at),
      status: row.status,
    };
  }

  async listSources(tag?: string): Promise<KnowledgeSourceRecord[]> {
    await this.ensureSchema();
    const res = tag
      ? await this.pool.query<{
          source_id: string;
          name: string;
          tags: string[];
          drive_modified_time: Date;
          last_synced_at: Date;
          status: 'active' | 'deleted';
        }>(
          'SELECT source_id, name, tags, drive_modified_time, last_synced_at, status FROM knowledge_sources WHERE tags @> $1::text[]',
          [[tag]],
        )
      : await this.pool.query<{
          source_id: string;
          name: string;
          tags: string[];
          drive_modified_time: Date;
          last_synced_at: Date;
          status: 'active' | 'deleted';
        }>(
          'SELECT source_id, name, tags, drive_modified_time, last_synced_at, status FROM knowledge_sources',
        );

    return res.rows.map((row) => ({
      sourceId: row.source_id,
      name: row.name,
      tags: row.tags,
      driveModifiedTime: new Date(row.drive_modified_time),
      lastSyncedAt: new Date(row.last_synced_at),
      status: row.status,
    }));
  }

  async saveSource(source: SaveKnowledgeSourceInput): Promise<void> {
    await this.ensureSchema();
    const status = source.status ?? 'active';
    await this.pool.query(
      `INSERT INTO knowledge_sources (source_id, name, tags, drive_modified_time, last_synced_at, status)
       VALUES ($1, $2, $3::text[], $4, now(), $5)
       ON CONFLICT (source_id) DO UPDATE SET
         name = EXCLUDED.name,
         tags = EXCLUDED.tags,
         drive_modified_time = EXCLUDED.drive_modified_time,
         last_synced_at = now(),
         status = EXCLUDED.status`,
      [
        source.sourceId,
        source.name,
        source.tags,
        source.driveModifiedTime,
        status,
      ],
    );
  }

  private async ensureSchema(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.pool.query(POSTGRES_SCHEMA_SQL);
        try {
          await this.pool.query(KNOWLEDGE_HNSW_INDEX_SQL);
        } catch {
          // El índice HNSW es opcional; la búsqueda funciona sin él en volúmenes pequeños.
        }
      })();
    }
    await this.ready;
  }
}
