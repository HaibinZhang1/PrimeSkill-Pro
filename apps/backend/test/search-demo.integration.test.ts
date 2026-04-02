import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, resetDatabase } from './helpers/test-db';

let app: INestApplication;
let authHeader: string;

before(async () => {
  app = await createApp();
  await app.init();
  authHeader = `Bearer ${encodeAuthToken({
    userId: 1,
    clientDeviceId: 10,
    departmentIds: [1],
    roleCodes: ['normal_user']
  })}`;
});

after(async () => {
  await app.close();
  await closeInfra();
});

beforeEach(async () => {
  await resetDatabase();
  await flushRedis();
});

test('search returns featured demo catalog when database catalog is empty', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/desktop/search/skills')
    .set('authorization', authHeader)
    .send({
      query: '',
      page: 1,
      pageSize: 6,
      toolContext: ['cursor']
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'featured');
  assert.equal(res.body.source, 'demo_catalog');
  assert.equal(res.body.degraded, false);
  assert.ok(Array.isArray(res.body.items));
  assert.ok(res.body.items.length > 0);
});

test('search returns demo catalog matches for keyword queries when database catalog is empty', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/desktop/search/skills')
    .set('authorization', authHeader)
    .send({
      query: 'api',
      page: 1,
      pageSize: 6,
      toolContext: ['cursor']
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mode, 'search');
  assert.equal(res.body.source, 'demo_catalog');
  assert.equal(res.body.degraded, true);
  assert.equal(res.body.degradedReason, 'demo_catalog_fallback');
  assert.ok(
    (res.body.items as Array<{ name: string }>).some((item) => item.name === 'API Contract Assistant'),
    JSON.stringify(res.body)
  );
});
