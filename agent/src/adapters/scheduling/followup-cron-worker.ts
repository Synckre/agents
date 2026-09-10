import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ProcessFollowupUseCase } from '@core/use-cases/process-followup.use-case';

export interface FollowupCronWorkerConfig {
  readonly intervalMinutes: number;
  readonly batchSize: number;
  readonly maxRetries: number;
  readonly staleMinutes: number;
}

/**
 * Driver independiente de cron para la ejecución periódica de seguimientos y recordatorios.
 * Implementa:
 * 1. Bloqueo optimista (claimForProcessing) para concurrencia entre múltiples instancias.
 * 2. Recuperación de tareas atascadas (stale).
 * 3. Procesamiento en lotes (batch processing).
 * 4. Manejo de reintentos con límite máximo.
 */
export class FollowupCronWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly scheduler: IFollowupScheduler,
    private readonly useCase: ProcessFollowupUseCase,
    private readonly config: FollowupCronWorkerConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(1, this.config.intervalMinutes) * 60 * 1000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    // Primer tick inmediato al arrancar el worker
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;

    try {
      const dueItems = await this.scheduler.findDue(
        now,
        this.config.batchSize,
        this.config.staleMinutes,
      );

      for (const item of dueItems) {
        // Bloqueo optimista atómico
        const claimed = await this.scheduler.claimForProcessing(item.id, this.config.staleMinutes);
        if (!claimed) {
          // Otra réplica del worker ya tomó la tarea
          continue;
        }

        try {
          await this.useCase.execute(item);
          await this.scheduler.markAsSent(item.id);
          processed += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Execution failed';
          console.error(`[FollowupCronWorker] Error processing followup ${item.id}:`, reason);
          await this.scheduler.markAsFailed(item.id, reason, this.config.maxRetries);
        }
      }
    } catch (err) {
      console.error('[FollowupCronWorker] Query error:', err);
    } finally {
      this.running = false;
    }

    return processed;
  }
}
