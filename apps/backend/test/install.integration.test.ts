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
  const manifestSnapshot = JSON.parse(record.rows[0].manifest_snapshot_json) as { ticketId?: string };
  assert.match(manifestSnapshot.ticketId ?? '', /^tk_/);

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

test('install detail endpoint and uninstall flow remove active binding', async () => {
  const installTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-detail-001'
    });

  assert.equal(installTicketRes.status, 200, JSON.stringify(installTicketRes.body));
  const installTicket = installTicketRes.body as { ticketId: string; installRecordId: number };

  for (const stage of ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const) {
    const consumeRes = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${installTicket.ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId: installTicket.installRecordId,
        stage,
        result: 'ok',
        traceId: `trace-install-detail-${stage}`
      });
    assert.equal(consumeRes.status, 200, JSON.stringify(consumeRes.body));
  }

  const installReportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${installTicket.installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      traceId: 'trace-install-detail-final'
    });
  assert.equal(installReportRes.status, 200, JSON.stringify(installReportRes.body));

  const myInstallsRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(myInstallsRes.status, 200, JSON.stringify(myInstallsRes.body));
  assert.equal(myInstallsRes.body.items.length, 1);
  const bindingId = myInstallsRes.body.items[0].bindingId as number;

  const detailRes = await request(app.getHttpServer())
    .get(`/api/my/installs/${bindingId}`)
    .set('authorization', authHeader);
  assert.equal(detailRes.status, 200, JSON.stringify(detailRes.body));
  assert.equal(detailRes.body.bindingId, bindingId);
  assert.equal(detailRes.body.manifest.templateCode, 'cursor_project_rule');
  assert.equal(detailRes.body.manifest.contentManagementMode, 'replace');

  const uninstallTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'uninstall',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-uninstall-detail-001'
    });
  assert.equal(uninstallTicketRes.status, 200, JSON.stringify(uninstallTicketRes.body));
  const uninstallTicket = uninstallTicketRes.body as {
    ticketId: string;
    installRecordId: number;
    retryToken?: string;
  };

  for (const stage of ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const) {
    const consumeRes = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${uninstallTicket.ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId: uninstallTicket.installRecordId,
        stage,
        result: 'ok',
        traceId: `trace-uninstall-detail-${stage}`,
        retryToken: uninstallTicket.retryToken
      });
    assert.equal(consumeRes.status, 200, JSON.stringify(consumeRes.body));
  }

  const uninstallReportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${uninstallTicket.installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      traceId: 'trace-uninstall-detail-final'
    });
  assert.equal(uninstallReportRes.status, 200, JSON.stringify(uninstallReportRes.body));

  const installsAfterUninstallRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(installsAfterUninstallRes.status, 200, JSON.stringify(installsAfterUninstallRes.body));
  assert.deepEqual(installsAfterUninstallRes.body.items, []);

  const removedBinding = await queryDb<{ state: string; removed_at: string | null }>(
    `
      SELECT state, removed_at::text
      FROM local_install_binding
      WHERE client_device_id = 10
        AND resolved_target_path = 'D:/repo/demo/.cursor/rules/api_contract.mdc'
      ORDER BY id DESC
      LIMIT 1
    `
  );
  assert.equal(removedBinding.rows[0].state, 'removed');
  assert.ok(removedBinding.rows[0].removed_at);
});

test('rollback flow removes active binding and finalizes install record as rolled_back', async () => {
  const installTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-rollback-001'
    });

  assert.equal(installTicketRes.status, 200, JSON.stringify(installTicketRes.body));
  const installTicket = installTicketRes.body as { ticketId: string; installRecordId: number };

  for (const stage of ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const) {
    const consumeRes = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${installTicket.ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId: installTicket.installRecordId,
        stage,
        result: 'ok',
        traceId: `trace-install-rollback-${stage}`
      });
    assert.equal(consumeRes.status, 200, JSON.stringify(consumeRes.body));
  }

  const installReportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${installTicket.installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      traceId: 'trace-install-rollback-final'
    });
  assert.equal(installReportRes.status, 200, JSON.stringify(installReportRes.body));

  const rollbackTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'rollback',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-rollback-flow-001'
    });
  assert.equal(rollbackTicketRes.status, 200, JSON.stringify(rollbackTicketRes.body));
  const rollbackTicket = rollbackTicketRes.body as {
    ticketId: string;
    installRecordId: number;
    retryToken?: string;
  };

  for (const stage of ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const) {
    const consumeRes = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${rollbackTicket.ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId: rollbackTicket.installRecordId,
        stage,
        result: 'ok',
        traceId: `trace-rollback-flow-${stage}`,
        retryToken: rollbackTicket.retryToken
      });
    assert.equal(consumeRes.status, 200, JSON.stringify(consumeRes.body));
  }

  const rollbackReportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${rollbackTicket.installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'rolled_back',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      traceId: 'trace-rollback-flow-final'
    });
  assert.equal(rollbackReportRes.status, 200, JSON.stringify(rollbackReportRes.body));

  const installsAfterRollbackRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(installsAfterRollbackRes.status, 200, JSON.stringify(installsAfterRollbackRes.body));
  assert.deepEqual(installsAfterRollbackRes.body.items, []);

  const rollbackRecord = await queryDb<{ install_status: string }>(
    `
      SELECT install_status
      FROM install_record
      WHERE id = $1
    `,
    [rollbackTicket.installRecordId]
  );
  assert.equal(rollbackRecord.rows[0].install_status, 'rolled_back');

  const removedBinding = await queryDb<{ state: string; removed_at: string | null }>(
    `
      SELECT state, removed_at::text
      FROM local_install_binding
      WHERE client_device_id = 10
        AND resolved_target_path = 'D:/repo/demo/.cursor/rules/api_contract.mdc'
      ORDER BY id DESC
      LIMIT 1
    `
  );
  assert.equal(removedBinding.rows[0].state, 'removed');
  assert.ok(removedBinding.rows[0].removed_at);
});

test('verify flow writes last_verified_at, marks drifted bindings, and still allows uninstall', async () => {
  const installTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'install',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-install-verify-001'
    });

  assert.equal(installTicketRes.status, 200, JSON.stringify(installTicketRes.body));
  const installTicket = installTicketRes.body as { ticketId: string; installRecordId: number };

  for (const stage of ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const) {
    const consumeRes = await request(app.getHttpServer())
      .post(`/api/native/install-tickets/${installTicket.ticketId}/consume`)
      .set('authorization', authHeader)
      .set('x-device-token', DEVICE_TOKEN)
      .send({
        installRecordId: installTicket.installRecordId,
        stage,
        result: 'ok',
        traceId: `trace-install-verify-${stage}`
      });
    assert.equal(consumeRes.status, 200, JSON.stringify(consumeRes.body));
  }

  const installReportRes = await request(app.getHttpServer())
    .post(`/api/native/install-operations/${installTicket.installRecordId}/report`)
    .set('authorization', authHeader)
    .set('x-device-token', DEVICE_TOKEN)
    .send({
      finalStatus: 'success',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      traceId: 'trace-install-verify-final'
    });
  assert.equal(installReportRes.status, 200, JSON.stringify(installReportRes.body));

  const installsRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(installsRes.status, 200, JSON.stringify(installsRes.body));
  assert.equal(installsRes.body.items.length, 1);
  const bindingId = installsRes.body.items[0].bindingId as number;

  const verifyRes = await request(app.getHttpServer())
    .post(`/api/my/installs/${bindingId}/verify`)
    .set('authorization', authHeader)
    .send({
      verificationStatus: 'drifted',
      resolvedTargetPath: 'D:/repo/demo/.cursor/rules/api_contract.mdc',
      driftReasons: ['content_hash_mismatch'],
      payload: {
        verificationStatus: 'drifted',
        files: [{ relativePath: 'api_contract.mdc', driftReasons: ['content_hash_mismatch'] }]
      },
      traceId: 'trace-verify-drifted'
    });
  assert.equal(verifyRes.status, 200, JSON.stringify(verifyRes.body));
  assert.equal(verifyRes.body.state, 'drifted');
  assert.ok(verifyRes.body.lastVerifiedAt);

  const bindingAfterVerify = await queryDb<{ state: string; last_verified_at: string | null }>(
    `
      SELECT state, last_verified_at::text
      FROM local_install_binding
      WHERE id = $1
    `,
    [bindingId]
  );
  assert.equal(bindingAfterVerify.rows[0].state, 'drifted');
  assert.ok(bindingAfterVerify.rows[0].last_verified_at);

  const installsAfterVerifyRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(installsAfterVerifyRes.status, 200, JSON.stringify(installsAfterVerifyRes.body));
  assert.equal(installsAfterVerifyRes.body.items.length, 1);
  assert.equal(installsAfterVerifyRes.body.items[0].state, 'drifted');
  assert.ok(installsAfterVerifyRes.body.items[0].lastVerifiedAt);

  const uninstallTicketRes = await request(app.getHttpServer())
    .post('/api/desktop/install-tickets')
    .set('authorization', authHeader)
    .send({
      skillId: 100,
      skillVersionId: 101,
      operationType: 'uninstall',
      targetScope: 'project',
      toolInstanceId: 20,
      workspaceRegistryId: 30,
      idempotencyKey: 'idem-uninstall-after-drift-001'
    });
  assert.equal(uninstallTicketRes.status, 200, JSON.stringify(uninstallTicketRes.body));
});
