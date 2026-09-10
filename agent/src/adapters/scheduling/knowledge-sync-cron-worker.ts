import {
  SyncFolderConfig,
  SyncKnowledgeBaseUseCase,
  SyncResult,
} from '@core/use-cases/sync-knowledge-base.use-case';

export interface KnowledgeSyncCronWorkerConfig {
  readonly intervalMinutes: number;
  readonly folders: SyncFolderConfig[];
  readonly chunkSize?: number;
  readonly overlap?: number;
}

/**
 * Worker cron periódico para la sincronización automática de la base de conocimiento desde Google Drive.
 * Se ejecuta en segundo plano independientemente del servidor HTTP y maneja su propio ciclo de polling.
 */
export class KnowledgeSyncCronWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly useCase: SyncKnowledgeBaseUseCase,
    private readonly config: KnowledgeSyncCronWorkerConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    // Primer tick inmediato al arrancar
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<SyncResult | null> {
    if (this.running) return null;
    this.running = true;

    try {
      const activeFolders = this.config.folders.filter((f) => Boolean(f.folderId));
      if (activeFolders.length === 0) {
        return null;
      }

      const result = await this.useCase.execute({
        folders: activeFolders,
        chunkSize: this.config.chunkSize,
        overlap: this.config.overlap,
      });

      if (result.newFiles > 0 || result.updatedFiles > 0 || result.deletedFiles > 0) {
        console.log(
          `[KnowledgeSync] Synced: +${result.newFiles} new, ~${result.updatedFiles} updated, -${result.deletedFiles} deleted, =${result.unchangedFiles} unchanged`,
        );
      }

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.warn(`[KnowledgeSync] Warning on file '${err.fileName}' (${err.fileId}): ${err.error}`);
        }
      }

      return result;
    } catch (error) {
      console.error(
        '[KnowledgeSync] Unexpected error during knowledge sync tick:',
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      this.running = false;
    }
  }
}
