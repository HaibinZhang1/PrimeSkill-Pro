import { randomUUID } from 'crypto';

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

interface Stage1IndexJobPayload {
  jobType: 'Stage1IndexJob';
  jobId: string;
  skillVersionId: number;
  traceId: string;
  retry: number;
}

@Injectable()
export class SkillIndexQueueService implements OnModuleDestroy {
  private queue?: Queue<Stage1IndexJobPayload>;
  private connection?: IORedis;

  async enqueueStage1Index(skillVersionId: number, traceId: string): Promise<{ jobId: string }> {
    const jobId = `stage1:${skillVersionId}:${randomUUID()}`;
    const queue = await this.getQueue();
    const payload: Stage1IndexJobPayload = {
      jobType: 'Stage1IndexJob',
      jobId,
      skillVersionId,
      traceId,
      retry: 0
    };

    await queue.add(payload.jobType, payload, {
      jobId,
      attempts: 3,
      removeOnComplete: true,
      removeOnFail: false
    });

    return { jobId };
  }

  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
    }
    if (this.connection && this.connection.status !== 'end') {
      await this.connection.quit();
    }
  }

  private async getQueue(): Promise<Queue<Stage1IndexJobPayload>> {
    if (!this.queue) {
      this.connection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: null
      });
      this.queue = new Queue<Stage1IndexJobPayload>(
        process.env.SEARCH_WORKER_QUEUE_NAME ?? 'primeskill.search.jobs',
        {
          connection: this.connection
        }
      );
    }

    return this.queue;
  }
}
