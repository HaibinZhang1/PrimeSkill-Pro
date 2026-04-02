import type { QueueJob } from './jobs/contracts';
import { MockEmbeddingProvider } from './embedding/mock-embedding.provider';
import { StageWorker } from './stage-worker';
import { WorkerDb } from './worker-db';

type QueueWorkerHandle = {
  close?: () => Promise<void>;
};

type SearchWorkerLogger = {
  log: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

type BootSearchWorkerOptions = {
  mode?: string;
  startQueueConsumer?: () => Promise<QueueWorkerHandle>;
  logger?: SearchWorkerLogger;
};

export async function handleJob(job: QueueJob): Promise<string> {
  const db = new WorkerDb();
  const worker = new StageWorker(db, new MockEmbeddingProvider());

  try {
    switch (job.jobType) {
      case 'Stage1IndexJob':
        await worker.processStage1(job);
        return `stage1-index:${job.skillVersionId}`;
      case 'Stage2IndexJob':
        await worker.processStage2(job);
        return `stage2-index:${job.skillVersionId}`;
      case 'SearchAssembleJob':
        return `search-assemble:${job.requestId}`;
      case 'ReconcileJob':
        return `reconcile:${job.installRecordId}`;
      default:
        return 'unknown';
    }
  } finally {
    await db.close();
  }
}

async function defaultStartQueueConsumer(): Promise<QueueWorkerHandle> {
  const { startQueueConsumer } = await import('./queue-consumer');
  return startQueueConsumer();
}

export async function bootSearchWorker(
  options: BootSearchWorkerOptions = {}
): Promise<QueueWorkerHandle | undefined> {
  const mode = options.mode ?? process.env.SEARCH_WORKER_MODE ?? 'standalone';
  const startQueueConsumer = options.startQueueConsumer ?? defaultStartQueueConsumer;
  const logger = options.logger ?? {
    log: (message: string) => {
      // eslint-disable-next-line no-console
      console.log(message);
    },
    error: (message: string, error?: unknown) => {
      // eslint-disable-next-line no-console
      console.error(message, error);
    }
  };

  if (mode === 'queue') {
    const worker = await startQueueConsumer();
    logger.log('PrimeSkill search-worker queue consumer started');
    return worker;
  }

  logger.log('PrimeSkill search-worker boot (standalone mode)');
  return undefined;
}

if (require.main === module) {
  bootSearchWorker().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('PrimeSkill search-worker failed to boot', error);
    process.exit(1);
  });
}
