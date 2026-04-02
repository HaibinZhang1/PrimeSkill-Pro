import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

let app: INestApplication;
let authHeader: string;

async function seedSearchFixture() {
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
    INSERT INTO "user" (id, username, display_name, email, department_id)
      VALUES (1, 'alice', 'Alice', 'alice@example.com', 1);

    INSERT INTO skill (id, skill_key, name, summary, owner_user_id, owner_department_id, status, visibility_type)
      VALUES
      (200, 'allowed_skill', 'Allowed Contract Helper', 'contract generator allowed', 1, 1, 'published', 'public'),
      (201, 'denied_skill', 'Denied Contract Helper', 'contract generator denied', 1, 1, 'published', 'public');

    INSERT INTO skill_version (
      id, skill_id, version, package_uri, manifest_json, checksum, created_by, review_status
    ) VALUES
      (210, 200, '1.0.0', 'https://example.test/allowed.zip', '{}'::jsonb, 'sha256:allowed', 1, 'approved'),
      (211, 201, '1.0.0', 'https://example.test/denied.zip', '{}'::jsonb, 'sha256:denied', 1, 'approved');

    UPDATE skill SET current_version_id = 210 WHERE id = 200;
    UPDATE skill SET current_version_id = 211 WHERE id = 201;

    INSERT INTO skill_search_profile (
      skill_version_id, title_text, summary_text, keyword_document, supported_tools_json, metadata_json
    ) VALUES
      (210, 'Allowed Contract Helper', 'allowed', 'contract api assistant', '["cursor"]'::jsonb, '{}'::jsonb),
      (211, 'Denied Contract Helper', 'denied', 'contract api assistant', '["cursor"]'::jsonb, '{}'::jsonb);

    INSERT INTO skill_permission_rule (
      skill_id, rule_type, subject_type, subject_ref_id, effect
    ) VALUES
      (201, 'view', 'user', 1, 'deny');
  `);
}

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
  await seedSearchFixture();
});

test('search applies permission prefilter before recall candidates', async () => {
  const res = await request(app.getHttpServer())
    .post('/api/desktop/search/skills')
    .set('authorization', authHeader)
    .send({
      query: 'contract',
      page: 1,
      pageSize: 10,
      toolContext: ['cursor']
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.degraded, true);
  assert.equal(res.body.degradedReason, 'llm_unavailable');

  const ids = (res.body.items as Array<{ skillId: number }>).map((it) => it.skillId);
  assert.ok(ids.includes(200));
  assert.ok(!ids.includes(201), 'denied skill must be filtered before recall');
});
