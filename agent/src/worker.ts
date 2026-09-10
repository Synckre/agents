import { createPgPool } from '@adapters/persistence/create-pg-pool';
import { PostgresFollowupScheduler } from '@adapters/persistence/postgres-followup-scheduler.adapter';
import { ResendAdapter } from '@adapters/email/resend.adapter';
import { ErpNextAdapter } from '@adapters/crm/erpnext.adapter';
import { createLlmProvider } from '@adapters/llm/create-llm-provider';
import { FollowupCronWorker } from '@adapters/scheduling/followup-cron-worker';
import { KnowledgeSyncCronWorker } from '@adapters/scheduling/knowledge-sync-cron-worker';
import { env } from '@config/env';
import { ProcessFollowupUseCase } from '@core/use-cases/process-followup.use-case';

/**
 * Punto de entrada independiente para el Worker de Seguimientos y Recordatorios.
 * Corre en su propio proceso desacoplado del servidor HTTP del chatbox.
 */
async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the followup worker');
  }

  const pool = createPgPool(env.DATABASE_URL);
  const scheduler = new PostgresFollowupScheduler(pool);

  const emailSender = new ResendAdapter({
    apiKey: env.RESEND_API_KEY,
    defaultFrom: env.EMAIL_FROM,
  });

  const crm = new ErpNextAdapter({
    baseUrl: env.ERPNEXT_URL,
    apiKey: env.ERPNEXT_API_KEY,
    apiSecret: env.ERPNEXT_API_SECRET,
  });

  const llm = createLlmProvider();

  const useCase = new ProcessFollowupUseCase({
    llm,
    emailSender,
    followupScheduler: scheduler,
    crm,
    internalAlertEmail: env.INTERNAL_ALERT_EMAIL,
  });

  const worker = new FollowupCronWorker(scheduler, useCase, {
    intervalMinutes: env.FOLLOWUP_CHECK_INTERVAL_MINUTES,
    batchSize: env.FOLLOWUP_BATCH_SIZE,
    maxRetries: env.FOLLOWUP_MAX_RETRIES,
    staleMinutes: env.FOLLOWUP_STALE_PROCESSING_MINUTES,
  });

  console.log(
    `[Worker] FollowupCronWorker started (interval: ${env.FOLLOWUP_CHECK_INTERVAL_MINUTES}m, batch: ${env.FOLLOWUP_BATCH_SIZE}, maxRetries: ${env.FOLLOWUP_MAX_RETRIES}, staleTimeout: ${env.FOLLOWUP_STALE_PROCESSING_MINUTES}m)`,
  );
  worker.start();

  let syncWorker: KnowledgeSyncCronWorker | null = null;
  const hasDriveFolders =
    Boolean(env.GOOGLE_DRIVE_PUBLIC_FOLDER_ID) || Boolean(env.GOOGLE_DRIVE_INTERNAL_FOLDER_ID);

  if (hasDriveFolders && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const { GoogleAdapter } = await import('@adapters/google/google.adapter');
    const { GoogleDriveSourceAdapter } = await import('@adapters/knowledge/google-drive-source.adapter');
    const { PgVectorKnowledgeBase } = await import('@adapters/knowledge/pgvector-knowledge-base.adapter');
    const { OllamaEmbeddingAdapter } = await import('@adapters/embeddings/ollama.adapter');
    const { SyncKnowledgeBaseUseCase } = await import('@core/use-cases/sync-knowledge-base.use-case');

    const google = new GoogleAdapter({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    });
    const driveSource = new GoogleDriveSourceAdapter(google);
    const embeddings = new OllamaEmbeddingAdapter({
      baseUrl: env.OLLAMA_BASE_URL,
      model: env.OLLAMA_EMBED_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
    });
    const knowledge = new PgVectorKnowledgeBase(pool, embeddings);
    const syncUseCase = new SyncKnowledgeBaseUseCase(driveSource, knowledge, embeddings);

    syncWorker = new KnowledgeSyncCronWorker(syncUseCase, {
      intervalMinutes: env.KNOWLEDGE_SYNC_INTERVAL_MINUTES,
      folders: [
        { folderId: env.GOOGLE_DRIVE_PUBLIC_FOLDER_ID ?? '', tag: 'public' },
        { folderId: env.GOOGLE_DRIVE_INTERNAL_FOLDER_ID ?? '', tag: 'internal' },
      ],
    });

    console.log(
      `[Worker] KnowledgeSyncCronWorker started (interval: ${env.KNOWLEDGE_SYNC_INTERVAL_MINUTES}m)`,
    );
    syncWorker.start();
  }

  const shutdown = async () => {
    console.log('[Worker] Shutting down worker...');
    worker.stop();
    syncWorker?.stop();
    await pool.end().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[pg] pool end:', message);
    });
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((err) => {
  console.error('[Worker] Fatal error during startup:', err);
  process.exit(1);
});
