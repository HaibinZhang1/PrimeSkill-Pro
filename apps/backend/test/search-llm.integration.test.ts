import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

let app: INestApplication;
let authHeader: string;
let llmServer: ReturnType<typeof createServer>;
let llmPort = 0;

const prevSearchLlmEndpoint = process.env.SEARCH_LLM_ENDPOINT;
const prevSearchLlmTimeoutMs = process.env.SEARCH_LLM_TIMEOUT_MS;

async function seedSearchFixture() {
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
    INSERT INTO "user" (id, username, display_name, email, department_id)
      VALUES (1, 'alice', 'Alice', 'alice@example.com', 1);

    INSERT INTO skill (id, skill_key, name, summary, owner_user_id, owner_department_id, status, visibility_type)
      VALUES
      (300, 'contract_a', 'Contract Skill A', 'contract helper A', 1, 1, 'published', 'public'),
      (301, 'contract_b', 'Contract Skill B', 'contract helper B', 1, 1, 'published', 'public');

    INSERT INTO skill_version (
      id, skill_id, version, package_uri, manifest_json, checksum, created_by, review_status
    ) VALUES
      (310, 300, '1.0.0', 'https://example.test/a.zip', '{}'::jsonb, 'sha256:a', 1, 'approved'),
      (311, 301, '1.0.0', 'https://example.test/b.zip', '{}'::jsonb, 'sha256:b', 1, 'approved');

    UPDATE skill SET current_version_id = 310 WHERE id = 300;
    UPDATE skill SET current_version_id = 311 WHERE id = 301;

    INSERT INTO skill_search_profile (
      skill_version_id, title_text, summary_text, keyword_document, supported_tools_json, metadata_json
    ) VALUES
      (310, 'Contract Skill A', 'A', 'contract api assistant', '["cursor"]'::jsonb, '{}'::jsonb),
      (311, 'Contract Skill B', 'B', 'contract api assistant', '["cursor"]'::jsonb, '{}'::jsonb);
  `);
}

before(async () => {
  llmServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        orderedSkillVersionIds: [311, 310],
        reasons: {
          '311': '更匹配 API 合同关键词',
          '310': '次优匹配'
        }
      })
    );
  });

  await new Promise<void>((resolve) => {
    llmServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = llmServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('failed to start llm mock server');
  }
  llmPort = addr.port;

  process.env.SEARCH_LLM_ENDPOINT = `http://127.0.0.1:${llmPort}/rerank`;
  process.env.SEARCH_LLM_TIMEOUT_MS = '1200';

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
  await new Promise<void>((resolve, reject) => {
    llmServer.close((err) => (err ? reject(err) : resolve()));
  });

  if (prevSearchLlmEndpoint === undefined) {
    delete process.env.SEARCH_LLM_ENDPOINT;
  } else {
    process.env.SEARCH_LLM_ENDPOINT = prevSearchLlmEndpoint;
  }
  if (prevSearchLlmTimeoutMs === undefined) {
    delete process.env.SEARCH_LLM_TIMEOUT_MS;
  } else {
    process.env.SEARCH_LLM_TIMEOUT_MS = prevSearchLlmTimeoutMs;
  }
});

beforeEach(async () => {
  await resetDatabase();
  await flushRedis();
  await seedSearchFixture();
});

test('search uses llm post-rank provider when available', async () => {
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
  assert.equal(res.body.degraded, false);
  assert.equal(res.body.items[0].skillVersionId, 311);
  assert.equal(res.body.items[0].whyMatched, '更匹配 API 合同关键词');
});
