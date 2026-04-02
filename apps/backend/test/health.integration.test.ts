import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';

let app: INestApplication;

before(async () => {
  app = await createApp();
  await app.init();
});

after(async () => {
  await app.close();
});

test('health endpoint returns ok status', async () => {
  const res = await request(app.getHttpServer()).get('/health');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, service: 'backend' });
});
