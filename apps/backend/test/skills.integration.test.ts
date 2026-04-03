import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { URL } from 'node:url';

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

function parseBinary(res: any, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.setEncoding(null);
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
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

test('inline artifact publish creates internal package uri and serves zip bytes', async () => {
  const createSkillRes = await request(app.getHttpServer())
    .post('/api/skills')
    .set('authorization', ownerAuthHeader)
    .send({
      skillKey: 'inline_artifact_skill',
      name: 'Inline Artifact Skill',
      visibilityType: 'department'
    });
  assert.equal(createSkillRes.status, 201, JSON.stringify(createSkillRes.body));
  const skillId = createSkillRes.body.skillId as number;

  const createVersionRes = await request(app.getHttpServer())
    .post(`/api/skills/${skillId}/versions`)
    .set('authorization', ownerAuthHeader)
    .send({
      version: '1.0.0',
      readmeText: 'inline release',
      aiToolsJson: ['cursor'],
      installModeJson: { scope: 'project' },
      artifact: {
        format: 'zip',
        entries: [{ path: 'rule.mdc', content: '# Inline Rule\n\nUse JSON.' }]
      }
    });

  assert.equal(createVersionRes.status, 201, JSON.stringify(createVersionRes.body));
  assert.equal(createVersionRes.body.packageSource, 'internal');
  assert.match(createVersionRes.body.packageUri as string, /\/artifacts\/skill-version-artifacts\//);
  assert.match(createVersionRes.body.checksum as string, /^sha256:/);

  const packagePath = new URL(createVersionRes.body.packageUri as string).pathname;
  const downloadRes = await request(app.getHttpServer())
    .get(packagePath)
    .buffer(true)
    .parse(parseBinary);

  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers['x-primeskill-checksum'], createVersionRes.body.checksum);
  assert.match(downloadRes.headers['content-type'], /application\/zip/);
  assert.equal(Buffer.isBuffer(downloadRes.body), true);
  assert.equal((downloadRes.body as Buffer).subarray(0, 4).toString('binary'), 'PK\u0003\u0004');
});

test('admin endpoints expose current versions, internal artifact metadata, and active review queue', async () => {
  const publishedSkillRes = await request(app.getHttpServer())
    .post('/api/skills')
    .set('authorization', ownerAuthHeader)
    .send({
      skillKey: 'published_admin_skill',
      name: 'Published Admin Skill',
      summary: 'published summary',
      visibilityType: 'department'
    });
  assert.equal(publishedSkillRes.status, 201, JSON.stringify(publishedSkillRes.body));
  const publishedSkillId = publishedSkillRes.body.skillId as number;

  const publishedVersionRes = await request(app.getHttpServer())
    .post(`/api/skills/${publishedSkillId}/versions`)
    .set('authorization', ownerAuthHeader)
    .send({
      version: '1.0.0',
      aiToolsJson: ['cursor'],
      installModeJson: { scope: 'project' },
      artifact: {
        format: 'zip',
        entries: [{ path: 'rule.mdc', content: '# Published\n' }]
      }
    });
  assert.equal(publishedVersionRes.status, 201, JSON.stringify(publishedVersionRes.body));
  const publishedVersionId = publishedVersionRes.body.skillVersionId as number;

  const publishedReviewRes = await request(app.getHttpServer())
    .post(`/api/skills/${publishedSkillId}/submit-review`)
    .set('authorization', ownerAuthHeader)
    .send({
      skillVersionId: publishedVersionId,
      reviewerId: 2,
      comment: 'publish this'
    });
  assert.equal(publishedReviewRes.status, 201, JSON.stringify(publishedReviewRes.body));

  const approveRes = await request(app.getHttpServer())
    .post(`/api/reviews/${publishedReviewRes.body.reviewTaskId as number}/approve`)
    .set('authorization', reviewerAuthHeader)
    .send({});
  assert.equal(approveRes.status, 200, JSON.stringify(approveRes.body));

  const pendingSkillRes = await request(app.getHttpServer())
    .post('/api/skills')
    .set('authorization', ownerAuthHeader)
    .send({
      skillKey: 'pending_admin_skill',
      name: 'Pending Admin Skill',
      summary: 'pending summary',
      visibilityType: 'department'
    });
  assert.equal(pendingSkillRes.status, 201, JSON.stringify(pendingSkillRes.body));
  const pendingSkillId = pendingSkillRes.body.skillId as number;

  const pendingVersionRes = await request(app.getHttpServer())
    .post(`/api/skills/${pendingSkillId}/versions`)
    .set('authorization', ownerAuthHeader)
    .send({
      version: '0.9.0',
      aiToolsJson: ['opencode'],
      installModeJson: { scope: 'project' },
      artifact: {
        format: 'legacy_json',
        entries: [{ path: 'SKILL.md', content: '# Pending\n' }]
      }
    });
  assert.equal(pendingVersionRes.status, 201, JSON.stringify(pendingVersionRes.body));
  const pendingVersionId = pendingVersionRes.body.skillVersionId as number;

  const pendingReviewRes = await request(app.getHttpServer())
    .post(`/api/skills/${pendingSkillId}/submit-review`)
    .set('authorization', ownerAuthHeader)
    .send({
      skillVersionId: pendingVersionId,
      reviewerId: 2,
      comment: 'queue this'
    });
  assert.equal(pendingReviewRes.status, 201, JSON.stringify(pendingReviewRes.body));

  const listRes = await request(app.getHttpServer())
    .get('/api/admin/skills')
    .set('authorization', reviewerAuthHeader);
  assert.equal(listRes.status, 200, JSON.stringify(listRes.body));
  const publishedItem = (listRes.body.items as Array<{ skillKey: string; currentVersion?: { artifact: { packageSource: string } } }>).find(
    (item) => item.skillKey === 'published_admin_skill'
  );
  assert.ok(publishedItem);
  assert.equal(publishedItem?.currentVersion?.artifact.packageSource, 'internal');

  const detailRes = await request(app.getHttpServer())
    .get(`/api/admin/skills/${pendingSkillId}`)
    .set('authorization', reviewerAuthHeader);
  assert.equal(detailRes.status, 200, JSON.stringify(detailRes.body));
  assert.equal(detailRes.body.skillKey, 'pending_admin_skill');
  assert.equal(detailRes.body.versions[0].artifact.packageSource, 'internal');
  assert.equal(detailRes.body.reviewTasks[0].taskStatus, 'assigned');

  const queueRes = await request(app.getHttpServer())
    .get('/api/admin/reviews/queue')
    .set('authorization', reviewerAuthHeader);
  assert.equal(queueRes.status, 200, JSON.stringify(queueRes.body));
  const queued = (queueRes.body.items as Array<{ skillKey: string; artifact: { packageFormat?: string } }>).find(
    (item) => item.skillKey === 'pending_admin_skill'
  );
  assert.ok(queued);
  assert.equal(queued?.artifact.packageFormat, 'legacy_json');
});

test('admin skill options endpoint exposes categories and tags for create skill form', async () => {
  const optionsRes = await request(app.getHttpServer())
    .get('/api/admin/skill-options')
    .set('authorization', reviewerAuthHeader);

  assert.equal(optionsRes.status, 200, JSON.stringify(optionsRes.body));
  assert.deepEqual(optionsRes.body.categories, [{ id: 10, name: 'Productivity' }]);
  assert.deepEqual(optionsRes.body.tags, [
    { id: 20, name: 'automation' },
    { id: 21, name: 'internal' }
  ]);
});
