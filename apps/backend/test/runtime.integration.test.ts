import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApp } from '../src/main';
import { encodeAuthToken } from './helpers/auth';
import { closeInfra, flushRedis, queryDb, resetDatabase } from './helpers/test-db';

const DEVICE_TOKEN = 'device-runtime-001';

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
  await queryDb(`
    INSERT INTO department (id, name, code) VALUES (1, 'Engineering', 'eng');
    INSERT INTO "user" (id, username, display_name, email, department_id)
      VALUES (1, 'alice', 'Alice', 'alice@example.com', 1);
  `);
});

test('device registration plus tool/workspace reporting powers my endpoints', async () => {
  const registerRes = await request(app.getHttpServer())
    .post('/api/client-devices/register')
    .set('authorization', authHeader)
    .send({
      deviceFingerprint: DEVICE_TOKEN,
      deviceName: 'Alice-PC',
      osType: 'windows',
      osVersion: '11',
      desktopAppVersion: '0.2.0',
      nativeCoreVersion: '0.2.0'
    });

  assert.equal(registerRes.status, 200, JSON.stringify(registerRes.body));
  assert.equal(registerRes.body.clientDeviceId, 10);
  assert.equal(registerRes.body.deviceFingerprint, DEVICE_TOKEN);

  const toolsRes = await request(app.getHttpServer())
    .post('/api/tool-instances/report')
    .set('authorization', authHeader)
    .send({
      items: [
        {
          toolCode: 'cursor',
          toolVersion: '0.48.8',
          osType: 'windows',
          detectedInstallPath: 'C:/Users/Alice/AppData/Local/Programs/Cursor/Cursor.exe',
          detectedConfigPath: 'C:/Users/Alice/.cursor',
          discoveredTargets: ['project'],
          trustStatus: 'verified'
        },
        {
          toolCode: 'opencode',
          toolVersion: '0.3.1',
          osType: 'windows',
          detectedInstallPath: 'C:/Users/Alice/AppData/Roaming/npm/opencode.cmd',
          detectedConfigPath: 'C:/Users/Alice/.config/opencode',
          discoveredTargets: ['project'],
          trustStatus: 'verified'
        }
      ]
    });

  assert.equal(toolsRes.status, 200, JSON.stringify(toolsRes.body));
  assert.equal(toolsRes.body.items.length, 2);
  assert.equal(toolsRes.body.items[0].clientDeviceId, 10);

  const workspacesRes = await request(app.getHttpServer())
    .post('/api/workspaces/report')
    .set('authorization', authHeader)
    .send({
      items: [
        {
          workspaceName: 'PrimeSkill-Pro',
          workspacePath: 'G:/train/PrimeSkill-Pro',
          projectFingerprint: 'fp-primeskill-pro',
          repoRemote: 'git@example.com:prime/PrimeSkill-Pro.git',
          repoBranch: 'main'
        }
      ]
    });

  assert.equal(workspacesRes.status, 200, JSON.stringify(workspacesRes.body));
  assert.equal(workspacesRes.body.items.length, 1);
  assert.equal(workspacesRes.body.items[0].workspacePath, 'G:/train/PrimeSkill-Pro');

  const myToolsRes = await request(app.getHttpServer())
    .get('/api/my/tool-instances')
    .set('authorization', authHeader);
  assert.equal(myToolsRes.status, 200);
  assert.equal(myToolsRes.body.items.length, 2);
  assert.deepEqual(
    myToolsRes.body.items.map((item: { toolCode: string }) => item.toolCode),
    ['cursor', 'opencode']
  );

  const myWorkspacesRes = await request(app.getHttpServer())
    .get('/api/my/workspaces')
    .set('authorization', authHeader);
  assert.equal(myWorkspacesRes.status, 200);
  assert.equal(myWorkspacesRes.body.items.length, 1);
  assert.equal(myWorkspacesRes.body.items[0].projectFingerprint, 'fp-primeskill-pro');

  const myInstallsRes = await request(app.getHttpServer())
    .get('/api/my/installs')
    .set('authorization', authHeader);
  assert.equal(myInstallsRes.status, 200);
  assert.deepEqual(myInstallsRes.body, { items: [] });
});
