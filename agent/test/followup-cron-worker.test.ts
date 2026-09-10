import { describe, expect, it, vi } from 'vitest';
import { FollowupCronWorker } from '@adapters/scheduling/followup-cron-worker';
import { ScheduledFollowup } from '@core/domain/scheduled-followup.entity';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ProcessFollowupUseCase } from '@core/use-cases/process-followup.use-case';

describe('FollowupCronWorker', () => {
  const sampleFollowup: ScheduledFollowup = {
    id: 'f-worker-1',
    leadId: 'L-1',
    conversationId: 'C-1',
    dueAt: new Date('2026-09-02T10:00:00Z'),
    type: 'followup',
    action: 'send_message',
    context: 'Revisar estatus',
    language: 'es',
    status: 'pending',
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('procesa tareas vencidas con bloqueo optimista y marca como sent', async () => {
    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn().mockResolvedValue([sampleFollowup]),
      claimForProcessing: vi.fn().mockResolvedValue(true),
      markAsSent: vi.fn().mockResolvedValue(undefined),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const mockUseCase = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProcessFollowupUseCase;

    const worker = new FollowupCronWorker(mockScheduler, mockUseCase, {
      intervalMinutes: 60,
      batchSize: 50,
      maxRetries: 3,
      staleMinutes: 15,
    });

    const count = await worker.tick();

    expect(count).toBe(1);
    expect(mockScheduler.findDue).toHaveBeenCalledWith(expect.any(Date), 50, 15);
    expect(mockScheduler.claimForProcessing).toHaveBeenCalledWith('f-worker-1', 15);
    expect(mockUseCase.execute).toHaveBeenCalledWith(sampleFollowup);
    expect(mockScheduler.markAsSent).toHaveBeenCalledWith('f-worker-1');
  });

  it('ignora tareas que no se pudieron reclamar por concurrencia', async () => {
    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn().mockResolvedValue([sampleFollowup]),
      claimForProcessing: vi.fn().mockResolvedValue(false), // Otra instancia ya la tomó
      markAsSent: vi.fn(),
      markAsFailed: vi.fn(),
      cancel: vi.fn(),
    };

    const mockUseCase = {
      execute: vi.fn(),
    } as unknown as ProcessFollowupUseCase;

    const worker = new FollowupCronWorker(mockScheduler, mockUseCase, {
      intervalMinutes: 60,
      batchSize: 50,
      maxRetries: 3,
      staleMinutes: 15,
    });

    const count = await worker.tick();

    expect(count).toBe(0);
    expect(mockUseCase.execute).not.toHaveBeenCalled();
    expect(mockScheduler.markAsSent).not.toHaveBeenCalled();
  });

  it('marca como failed ante error en el caso de uso', async () => {
    const mockScheduler: IFollowupScheduler = {
      schedule: vi.fn(),
      findDue: vi.fn().mockResolvedValue([sampleFollowup]),
      claimForProcessing: vi.fn().mockResolvedValue(true),
      markAsSent: vi.fn(),
      markAsFailed: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn(),
    };

    const mockUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('Resend network timeout')),
    } as unknown as ProcessFollowupUseCase;

    const worker = new FollowupCronWorker(mockScheduler, mockUseCase, {
      intervalMinutes: 60,
      batchSize: 50,
      maxRetries: 3,
      staleMinutes: 15,
    });

    const count = await worker.tick();

    expect(count).toBe(0);
    expect(mockScheduler.markAsFailed).toHaveBeenCalledWith('f-worker-1', 'Resend network timeout', 3);
  });
});
