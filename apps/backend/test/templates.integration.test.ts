import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

let app: INestApplication;
let adminAuthHeader: string;
let userAuthHeader: string;

async function seedTemplateFixture() {
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
    INSERT INTO "user" (id, username, display_name, email, department_id)
      VALUES (1, 'admin', 'Admin', 'admin@example.com', 1);
  `);
}

before(async () => {
  app = await createApp();
  await app.init();
  adminAuthHeader = `Bearer ${encodeAuthToken({
    userId: 1,
    clientDeviceId: 10,
    departmentIds: [1],
    roleCodes: ['platform_admin']
  })}`;
  userAuthHeader = `Bearer ${encodeAuthToken({
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
  await seedTemplateFixture();
});

test('admin can publish immutable template revision and duplicate revision is rejected', async () => {
  const createRes = await request(app.getHttpServer())
    .post('/api/admin/ai-tool-templates')
    .set('authorization', adminAuthHeader)
    .send({
      toolId: 1,
      templateCode: 'cursor_project_rule_v2',
      templateRevision: 2,
      osType: 'windows',
      artifactType: 'rule',
      scopeType: 'project',
      templateName: 'cursor project v2',
      targetPathTemplate: '${workspaceRoot}/.cursor/rules',
      filenameTemplate: '${skillKey}.mdc',
      packagingMode: 'single_file',
      contentManagementMode: 'replace',
      pathVariables: ['workspaceRoot', 'skillKey'],
      isDefault: false,
      releaseStatus: 'active',
      verificationStatus: 'candidate'
    });

  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  assert.ok(typeof createRes.body.templateId === 'number');

  const duplicatedRes = await request(app.getHttpServer())
    .post('/api/admin/ai-tool-templates')
    .set('authorization', adminAuthHeader)
    .send({
      toolId: 1,
      templateCode: 'cursor_project_rule_v2',
      templateRevision: 2,
      osType: 'windows',
      artifactType: 'rule',
      scopeType: 'project',
      templateName: 'cursor project v2 duplicate',
      targetPathTemplate: '${workspaceRoot}/.cursor/rules',
      filenameTemplate: '${skillKey}.mdc',
      packagingMode: 'single_file',
      contentManagementMode: 'replace',
      pathVariables: ['workspaceRoot', 'skillKey'],
      isDefault: false,
      releaseStatus: 'active',
      verificationStatus: 'candidate'
    });
  assert.equal(duplicatedRes.status, 409);
  assert.equal(duplicatedRes.body.code, 'TEMPLATE_REVISION_EXISTS');
});

test('template publish rejects invalid variables and non-admin caller', async () => {
  const invalidVariablesRes = await request(app.getHttpServer())
    .post('/api/admin/ai-tool-templates')
    .set('authorization', adminAuthHeader)
    .send({
      toolId: 1,
      templateCode: 'invalid_vars_case',
      templateRevision: 3,
      osType: 'windows',
      artifactType: 'rule',
      scopeType: 'project',
      templateName: 'invalid vars',
      targetPathTemplate: '${workspaceRoot}/.cursor/rules',
      filenameTemplate: '${skillKey}.mdc',
      packagingMode: 'single_file',
      contentManagementMode: 'replace',
      pathVariables: ['workspaceRoot'],
      isDefault: false,
      releaseStatus: 'active',
      verificationStatus: 'candidate'
    });
  assert.equal(invalidVariablesRes.status, 422);
  assert.equal(invalidVariablesRes.body.code, 'INVALID_TEMPLATE_VARIABLES');

  const forbiddenRes = await request(app.getHttpServer())
    .post('/api/admin/ai-tool-templates')
    .set('authorization', userAuthHeader)
    .send({
      toolId: 1,
      templateCode: 'user_forbidden_case',
      templateRevision: 4,
      osType: 'windows',
      artifactType: 'rule',
      scopeType: 'project',
      templateName: 'forbidden case',
      targetPathTemplate: '${workspaceRoot}/.cursor/rules',
      filenameTemplate: '${skillKey}.mdc',
      packagingMode: 'single_file',
      contentManagementMode: 'replace',
      pathVariables: ['workspaceRoot', 'skillKey'],
      isDefault: false,
      releaseStatus: 'active',
      verificationStatus: 'candidate'
    });
  assert.equal(forbiddenRes.status, 403);
  assert.equal(forbiddenRes.body.code, 'PERM_ROLE_FORBIDDEN');
});
