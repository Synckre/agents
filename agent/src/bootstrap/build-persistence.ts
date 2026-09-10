import type { Pool } from 'pg';
import { OllamaEmbeddingAdapter } from '@adapters/embeddings/ollama.adapter';
import { PgVectorKnowledgeBase } from '@adapters/knowledge/pgvector-knowledge-base.adapter';
import { PostgresFollowupScheduler } from '@adapters/persistence/postgres-followup-scheduler.adapter';
import { PostgresMemoryStore } from '@adapters/persistence/postgres-memory-store.adapter';
import { env } from '@config/env';

export interface PersistenceLayer {
  readonly memory: PostgresMemoryStore;
  readonly followupScheduler: PostgresFollowupScheduler;
  readonly knowledge: PgVectorKnowledgeBase;
}

export function buildPersistence(pool: Pool): PersistenceLayer {
  const memory = new PostgresMemoryStore(pool);

  const embeddings = new OllamaEmbeddingAdapter({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_EMBED_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
  });

  const knowledge = new PgVectorKnowledgeBase(pool, embeddings);
  const followupScheduler = new PostgresFollowupScheduler(pool);

  return {
    memory,
    followupScheduler,
    knowledge,
  };
}
