import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

let app: INestApplication;
let ownerAuthHeader: string;
let reviewerAuthHeader: string;
let normalUserAuthHeader: string;
let queueConnection: IORedis;
let queue: Queue;

async function seedSkillLifecycleFixture() {
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES
      (1, 'Engineering', 'eng'),
      (2, 'Security', 'sec');

    INSERT INTO "user" (id, username, display_name, email, department_id) VALUES
      (1, 'owner', 'Owner', 'owner@example.com', 1),
      (2, 'reviewer', 'Reviewer', 'reviewer@example.com', 2),
      (3, 'user', 'User', 'user@example.com', 1);

    INSERT INTO skill_category (id, name, created_by, updated_by)
      VALUES (10, 'Productivity', 1, 1);

    INSERT INTO skill_tag (id, name, created_by, updated_by)
      VALUES (20, 'automation', 1, 1), (21, 'internal', 1, 1);
  `);
}

before(async () => {
  app = await createApp();
  await app.init();

  ownerAuthHeader = `Bearer ${encodeAuthToken({
    userId: 1,
    clientDeviceId: 10,
    departmentIds: [1],
    roleCodes: ['normal_user']
  })}`;
  reviewerAuthHeader = `Bearer ${encodeAuthToken({
    userId: 2,
    clientDeviceId: 11,
    departmentIds: [2],
    roleCodes: ['reviewer']
  })}`;
  normalUserAuthHeader = `Bearer ${encodeAuthToken({
    userId: 3,
    clientDeviceId: 12,
    departmentIds: [1],
    roleCodes: ['normal_user']
  })}`;

  queueConnection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null
  });
  queue = new Queue(process.env.SEARCH_WORKER_QUEUE_NAME ?? 'primeskill.search.jobs', {
    connection: queueConnection
  });
});

after(async () => {
  await queue.close();
  await queueConnection.quit();
  await app.close();
  await closeInfra();
});

beforeEach(async () => {
  await resetDatabase();
  await flushRedis();
  await seedSkillLifecycleFixture();
});

test('owner can create skill, submit review, and reviewer approval publishes it and enqueues stage1 job', async () => {
  const createSkillRes = await request(app.getHttpServer())
    .post('/api/skills')
    .set('authorization', ownerAuthHeader)
    .send({
      skillKey: 'contract_assistant',
      name: 'Contract Assistant',
      summary: 'Help generate internal contract docs',
      description: 'Enterprise contract generator',
      categoryId: 10,
      visibilityType: 'department',
      tagIds: [20, 21]
    });

  assert.equal(createSkillRes.status, 201, JSON.stringify(createSkillRes.body));
  const skillId = createSkillRes.body.skillId as number;

  const createVersionRes = await request(app.getHttpServer())
    .post(`/api/skills/${skillId}/versions`)
    .set('authorization', ownerAuthHeader)
    .send({
      version: '1.0.0',
      packageUri: 'https://repo.internal/skills/contract_assistant-1.0.0.zip',
      manifestJson: {
        name: 'contract_assistant',
        entry: 'SKILL.md'
      },
      readmeText: 'This is the first release.',
      changelog: 'Initial version',
      aiToolsJson: ['cursor', 'opencode'],
      installModeJson: {
        scope: 'project'
      },
      checksum: 'sha256:abc123456789',
      signature: 'signed'
    });

  assert.equal(createVersionRes.status, 201, JSON.stringify(createVersionRes.body));
  const skillVersionId = createVersionRes.body.skillVersionId as number;

  const submitReviewRes = await request(app.getHttpServer())
    .post(`/api/skills/${skillId}/submit-review`)
    .set('authorization', ownerAuthHeader)
    .send({
      skillVersionId,
      reviewerId: 2,
      comment: 'Please review for release'
    });

  assert.equal(submitReviewRes.status, 201, JSON.stringify(submitReviewRes.body));
  const reviewTaskId = submitReviewRes.body.reviewTaskId as number;
  assert.equal(submitReviewRes.body.status, 'assigned');

  const approveRes = await request(app.getHttpServer())
    .post(`/api/reviews/${reviewTaskId}/approve`)
    .set('authorization', reviewerAuthHeader)
    .send({
      comment: 'Looks good'
    });

  assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));
  assert.equal(approveRes.body.skillStatus, 'published');
  assert.equal(approveRes.body.reviewStatus, 'approved');
  assert.ok(typeof approveRes.body.stage1JobId === 'string');

  const skillRow = await queryDb<{
    status: string;
    current_version_id: number;
  }>(
    `
      SELECT status, current_version_id
      FROM skill
      WHERE id = $1
    `,
    [skillId]
  );
  assert.equal(skillRow.rows[0].status, 'published');
  assert.equal(skillRow.rows[0].current_version_id, skillVersionId);

  const versionRow = await queryDb<{
    review_status: string;
    stage1_index_status: string;
    stage2_index_status: string;
    published_at: Date | null;
  }>(
    `
      SELECT review_status, stage1_index_status, stage2_index_status, published_at
      FROM skill_version
      WHERE id = $1
    `,
    [skillVersionId]
  );
  assert.equal(versionRow.rows[0].review_status, 'approved');
  assert.equal(versionRow.rows[0].stage1_index_status, 'pending');
  assert.equal(versionRow.rows[0].stage2_index_status, 'pending');
  assert.ok(versionRow.rows[0].published_at instanceof Date);

  const reviewRow = await queryDb<{
    status: string;
    reviewer_id: number;
    reviewed_at: Date | null;
  }>(
    `
      SELECT status, reviewer_id, reviewed_at
      FROM review_task
      WHERE id = $1
    `,
    [reviewTaskId]
  );
  assert.equal(reviewRow.rows[0].status, 'approved');
  assert.equal(reviewRow.rows[0].reviewer_id, 2);
  assert.ok(reviewRow.rows[0].reviewed_at instanceof Date);

  const queuedJob = await queue.getJob(approveRes.body.stage1JobId as string);
  assert.ok(queuedJob);
  assert.equal(queuedJob?.data.jobType, 'Stage1IndexJob');
  assert.equal(queuedJob?.data.skillVersionId, skillVersionId);
});

test('approve review requires reviewer or admin role', async () => {
  const createSkillRes = await request(app.getHttpServer())
    .post('/api/skills')
    .set('authorization', ownerAuthHeader)
    .send({
      skillKey: 'ops_helper',
      name: 'Ops Helper',
      visibilityType: 'department'
    });
  const skillId = createSkillRes.body.skillId as number;

  const createVersionRes = await request(app.getHttpServer())
    .post(`/api/skills/${skillId}/versions`)
    .set('authorization', ownerAuthHeader)
    .send({
      version: '1.0.0',
      packageUri: 'https://repo.internal/skills/ops_helper-1.0.0.zip',
      checksum: 'sha256:ops123456',
      manifestJson: {},
      aiToolsJson: []
    });
  const skillVersionId = createVersionRes.body.skillVersionId as number;

  const submitReviewRes = await request(app.getHttpServer())
    .post(`/api/skills/${skillId}/submit-review`)
    .set('authorization', ownerAuthHeader)
    .send({
      skillVersionId
    });
  const reviewTaskId = submitReviewRes.body.reviewTaskId as number;

  const forbiddenRes = await request(app.getHttpServer())
    .post(`/api/reviews/${reviewTaskId}/approve`)
    .set('authorization', normalUserAuthHeader)
    .send({
      comment: 'approve'
    });

  assert.equal(forbiddenRes.status, 403);
  assert.equal(forbiddenRes.body.code, 'PERM_ROLE_FORBIDDEN');
});
