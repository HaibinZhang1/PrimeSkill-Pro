import IORedis from 'ioredis';
import { Worker } from 'bullmq';

import type { QueueJob } from './jobs/contracts';
import { handleJob } from './index';

export async function startQueueConsumer() {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const queueName = process.env.SEARCH_WORKER_QUEUE_NAME ?? 'primeskill.search.jobs';
  const concurrency = Number(process.env.SEARCH_WORKER_CONCURRENCY ?? 4);
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null
  });

  const worker = new Worker<QueueJob>(
    queueName,
    async (job) => {
      return handleJob(job.data);
    },
    {
      connection,
      concurrency
    }
  );

  worker.on('completed', (job, result) => {
    // eslint-disable-next-line no-console
    console.log(`[search-worker] completed job=${job.id} type=${job.data.jobType} result=${result}`);
  });

  worker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`[search-worker] failed job=${job?.id ?? 'unknown'} error=${error.message}`);
  });

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
  };

  process.once('SIGINT', () => {
    shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    shutdown().finally(() => process.exit(0));
  });

  return worker;
}
