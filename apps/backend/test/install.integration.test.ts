import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

const DEVICE_TOKEN = 'device-token-001';

async function seedInstallFixture() {
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
    INSERT INTO "user" (id, username, display_name, email, department_id)
      VALUES (1, 'alice', 'Alice', 'alice@example.com', 1);
    INSERT INTO client_device (id, user_id, device_fingerprint, device_name, os_type)
      VALUES (10, 1, '${DEVICE_TOKEN}', 'Alice-PC', 'windows');
  `);

  const toolResult = await queryDb<{ id: number }>(`SELECT id FROM ai_tool_catalog WHERE tool_code = 'cursor' LIMIT 1`);
  const toolId = toolResult.rows[0].id;

  await queryDb(
    `
      INSERT INTO tool_instance (id, user_id, client_device_id, tool_id, os_type, trust_status)
      VALUES (20, 1, 10, $1, 'windows', 'verified')
    `,
    [toolId]
  );
  await queryDb(
    `
      INSERT INTO workspace_registry (id, user_id, client_device_id, workspace_name, workspace_path, project_fingerprint)
      VALUES (30, 1, 10, 'demo', 'D:/repo/demo', 'fp-demo')
    `
  );
  await queryDb(
    `
      INSERT INTO skill (id, skill_key, name, summary, owner_user_id, owner_department_id, status, visibility_type)
      VALUES (100, 'api_contract', 'API Contract Assistant', 'Generate API contracts quickly', 1, 1, 'published', 'public')
    `
  );
  await queryDb(
    `
      INSERT INTO skill_version (
        id, skill_id, version, package_uri, manifest_json, checksum, created_by, review_status
      ) VALUES (
        101, 100, '1.0.0', 'https://example.test/skill.zip', '{}'::jsonb, 'sha256:test', 1, 'approved'
      )
    `
  );
  await queryDb(`UPDATE skill SET current_version_id = 101 WHERE id = 100`);
}

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
  await seedInstallFixture();
});

test('install ticket lifecycle persists and blocks stage out-of-order', async () => {
  const createRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-flow-001'
    });

  assert.equal(createRes.status, 200, JSON.stringify(createRes.body));
  const { ticketId, installRecordId } = createRes.body as { ticketId: string; installRecordId: number };
  assert.ok(ticketId.startsWith('tk_'));

  const manifestRes = await request(app.getHttpServer())
    .get(`/api/native/install-tickets/${ticketId}/manifest`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN);
  assert.equal(manifestRes.status, 200);
  assert.equal(manifestRes.body.ticketId, ticketId);

  const consume1 = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'ticket_issued',
      result: 'ok',
      traceId: 'trace-install-1'
    });
  assert.equal(consume1.status, 200);
  assert.equal(consume1.body.nextAction, 'continue');

  const outOfOrder = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'verifying',
      result: 'ok',
      traceId: 'trace-install-2'
    });
  assert.equal(outOfOrder.status, 412);
  assert.equal(outOfOrder.body.code, 'INSTALL_STAGE_OUT_OF_ORDER');

  for (const [stage, traceId] of [
    ['downloading', 'trace-install-3'],
    ['staging', 'trace-install-4'],
    ['verifying', 'trace-install-5'],
    ['committing', 'trace-install-6']
  ] as const) {
    const res = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId,
        stage,
        result: 'ok',
        traceId
      });
    assert.equal(res.status, 200);
    assert.equal(res.body.nextAction, 'continue');
  }

  const reportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      traceId: 'trace-install-final'
    });
  assert.equal(reportRes.status, 200, JSON.stringify(reportRes.body));
  assert.deepEqual(reportRes.body, { ok: true });

  const record = await queryDb<{ install_status: string; manifest_snapshot_json: string }>(
    'SELECT install_status, manifest_snapshot_json::text AS manifest_snapshot_json FROM install_record WHERE id = $1',
    [installRecordId]
  );
  assert.equal(record.rows[0].install_status, 'success');
  assert.match(record.rows[0].manifest_snapshot_json, /"ticketId":"tk_/);

  const binding = await queryDb<{ c: string }>(
    `
      SELECT COUNT(*)::text AS c
      FROM local_install_binding
      WHERE install_record_id = $1
        AND state = 'active'
    `,
    [installRecordId]
  );
  assert.equal(binding.rows[0].c, '1');

  const myInstallsRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(myInstallsRes.status, 200, JSON.stringify(myInstallsRes.body));
  assert.equal(myInstallsRes.body.items.length, 1);
  assert.equal(myInstallsRes.body.items[0].installRecordId, installRecordId);
  assert.equal(myInstallsRes.body.items[0].targetScope, 'project');
});

test('idempotent_retry ticket allows repeated consume with same retry token', async () => {
  const createRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'upgrade',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-retry-001'
    });

  assert.equal(createRes.status, 200, JSON.stringify(createRes.body));
  const {
    ticketId,
    installRecordId,
    consumeMode,
    retryToken
  } = createRes.body as {
    ticketId: string;
    installRecordId: number;
    consumeMode: 'one_time' | 'idempotent_retry';
    retryToken?: string;
  };

  assert.equal(consumeMode, 'idempotent_retry');
  assert.ok(retryToken);

  const consumeFirst = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'ticket_issued',
      result: 'ok',
      traceId: 'trace-retry-1',
      retryToken
    });
  assert.equal(consumeFirst.status, 200);
  assert.equal(consumeFirst.body.nextAction, 'continue');

  const consumeRepeat = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'ticket_issued',
      result: 'ok',
      traceId: 'trace-retry-2',
      retryToken
    });
  assert.equal(consumeRepeat.status, 200);
  assert.equal(consumeRepeat.body.nextAction, 'continue');

  const consumeWrongRetry = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'ticket_issued',
      result: 'ok',
      traceId: 'trace-retry-3',
      retryToken: 'wrong-token'
    });
  assert.equal(consumeWrongRetry.status, 409);
  assert.equal(consumeWrongRetry.body.code, 'TICKET_RETRY_TOKEN_MISMATCH');
});

test('install ticket creation rejects when skill use permission is denied', async () => {
  await queryDb(
    `
      INSERT INTO skill_permission_rule (
        skill_id, rule_type, subject_type, subject_ref_id, effect
      ) VALUES (
        100, 'use', 'user', 1, 'deny'
      )
    `
  );

  const createRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-deny-001'
    });

  assert.equal(createRes.status, 403);
  assert.equal(createRes.body.code, 'PERM_NO_USE_PERMISSION');
});

test('permission revoke blocks manifest, consume, and successful final report for install flow', async () => {
  const createRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-revoke-001'
    });

  assert.equal(createRes.status, 200, JSON.stringify(createRes.body));
  const { ticketId, installRecordId } = createRes.body as { ticketId: string; installRecordId: number };

  await queryDb(
    `
      INSERT INTO skill_permission_rule (
        skill_id, rule_type, subject_type, subject_ref_id, effect
      ) VALUES (
        100, 'use', 'user', 1, 'deny'
      )
    `
  );

  const manifestRes = await request(app.getHttpServer())
    .get(`/api/native/install-tickets/${ticketId}/manifest`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN);
  assert.equal(manifestRes.status, 403);
  assert.equal(manifestRes.body.code, 'PERM_NO_USE_PERMISSION');

  const consumeRes = await request(app.getHttpServer())
    .post(`/api/native/install-tickets/${ticketId}/consume`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      installRecordId,
      stage: 'ticket_issued',
      result: 'ok',
      traceId: 'trace-permission-revoked-consume'
    });
  assert.equal(consumeRes.status, 403);
  assert.equal(consumeRes.body.code, 'PERM_NO_USE_PERMISSION');

  await queryDb(
    `
      UPDATE install_record
      SET install_status = 'committing'
      WHERE id = $1
    `,
    [installRecordId]
  );

  const reportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      traceId: 'trace-permission-revoked-report'
    });
  assert.equal(reportRes.status, 403);
  assert.equal(reportRes.body.code, 'PERM_NO_USE_PERMISSION');
});
