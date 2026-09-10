import { describe, expect, it, vi } from 'vitest';
import { KnowledgeSyncCronWorker } from '@adapters/scheduling/knowledge-sync-cron-worker';
import { SyncKnowledgeBaseUseCase, SyncResult } from '@core/use-cases/sync-knowledge-base.use-case';

describe('KnowledgeSyncCronWorker', () => {
  const sampleResult: SyncResult = {
    newFiles: 2,
    updatedFiles: 1,
    deletedFiles: 0,
    unchangedFiles: 3,
    errors: [],
  };

  it('ejecuta tick y llama a SyncKnowledgeBaseUseCase con carpetas activas', async () => {
    const mockUseCase = {
      execute: vi.fn().mockResolvedValue(sampleResult),
    } as unknown as SyncKnowledgeBaseUseCase;

    const worker = new KnowledgeSyncCronWorker(mockUseCase, {
      intervalMinutes: 60,
      folders: [
        { folderId: 'folder-pub', tag: 'public' },
        { folderId: '', tag: 'internal' }, // Vacía, debe filtrarse
      ],
      chunkSize: 500,
      overlap: 50,
    });

    const result = await worker.tick();

    expect(result).toEqual(sampleResult);
    expect(mockUseCase.execute).toHaveBeenCalledWith({
      folders: [{ folderId: 'folder-pub', tag: 'public' }],
      chunkSize: 500,
      overlap: 50,
    });
  });

  it('no ejecuta nada si no hay carpetas con folderId configuradas', async () => {
    const mockUseCase = {
      execute: vi.fn(),
    } as unknown as SyncKnowledgeBaseUseCase;

    const worker = new KnowledgeSyncCronWorker(mockUseCase, {
      intervalMinutes: 60,
      folders: [
        { folderId: '', tag: 'public' },
        { folderId: '', tag: 'internal' },
      ],
    });

    const result = await worker.tick();

    expect(result).toBeNull();
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('previene ejecuciones concurrentes simultáneas (bloqueo por flag running)', async () => {
    let resolveExecute: (val: SyncResult) => void;
    const pendingPromise = new Promise<SyncResult>((res) => {
      resolveExecute = res;
    });

    const mockUseCase = {
      execute: vi.fn().mockImplementation(() => pendingPromise),
    } as unknown as SyncKnowledgeBaseUseCase;

    const worker = new KnowledgeSyncCronWorker(mockUseCase, {
      intervalMinutes: 60,
      folders: [{ folderId: 'folder-pub', tag: 'public' }],
    });

    // Iniciar primer tick (quedará pendiente)
    const tick1Promise = worker.tick();

    // Iniciar segundo tick concurrente
    const tick2Result = await worker.tick();
    expect(tick2Result).toBeNull();

    // Resolver primer tick
    resolveExecute!(sampleResult);
    const tick1Result = await tick1Promise;
    expect(tick1Result).toEqual(sampleResult);
    expect(mockUseCase.execute).toHaveBeenCalledTimes(1);
  });

  it('captura errores inesperados sin propagar excepciones no controladas', async () => {
    const mockUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('Fatal database connection failure')),
    } as unknown as SyncKnowledgeBaseUseCase;

    const worker = new KnowledgeSyncCronWorker(mockUseCase, {
      intervalMinutes: 60,
      folders: [{ folderId: 'folder-pub', tag: 'public' }],
    });

    const result = await worker.tick();
    expect(result).toBeNull();
  });

  it('maneja el ciclo de vida start y stop correctamente', async () => {
    vi.useFakeTimers();
    try {
      const mockUseCase = {
        execute: vi.fn().mockResolvedValue(sampleResult),
      } as unknown as SyncKnowledgeBaseUseCase;

      const worker = new KnowledgeSyncCronWorker(mockUseCase, {
        intervalMinutes: 30,
        folders: [{ folderId: 'folder-pub', tag: 'public' }],
      });

      worker.start();
      // Esperar resolución del tick inicial
      await vi.advanceTimersByTimeAsync(0);
      expect(mockUseCase.execute).toHaveBeenCalledTimes(1);

      // Avanzar tiempo para el siguiente intervalo
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(mockUseCase.execute).toHaveBeenCalledTimes(2);

      worker.stop();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      // No debe haberse llamado una tercera vez
      expect(mockUseCase.execute).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
