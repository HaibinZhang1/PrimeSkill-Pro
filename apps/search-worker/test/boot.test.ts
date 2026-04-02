import assert from 'node:assert/strict';
import test from 'node:test';

import { bootSearchWorker } from '../src/index';

test('bootSearchWorker keeps standalone mode side-effect free', async () => {
  const logMessages: string[] = [];
  let queueStarted = false;

  const result = await bootSearchWorker({
    mode: 'standalone',
    startQueueConsumer: async () => {
      queueStarted = true;
      throw new Error('queue consumer should not start in standalone mode');
    },
    logger: {
      log: (message: string) => {
        logMessages.push(message);
      },
      error: () => undefined
    }
  });

  assert.equal(queueStarted, false);
  assert.equal(result, undefined);
  assert.deepEqual(logMessages, ['PrimeSkill search-worker boot (standalone mode)']);
});

test('bootSearchWorker starts queue consumer in queue mode', async () => {
  const logMessages: string[] = [];
  const workerHandle = {
    close: async () => undefined
  };
  let queueStarted = 0;

  const result = await bootSearchWorker({
    mode: 'queue',
    startQueueConsumer: async () => {
      queueStarted += 1;
      return workerHandle;
    },
    logger: {
      log: (message: string) => {
        logMessages.push(message);
      },
      error: () => undefined
    }
  });

  assert.equal(queueStarted, 1);
  assert.equal(result, workerHandle);
  assert.deepEqual(logMessages, ['PrimeSkill search-worker queue consumer started']);
});
