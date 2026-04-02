import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';

import { AppException } from '../src/common/app.exception';
import type { AuthContext } from '../src/common/http.types';
import { InstallAuthorizationService } from '../src/modules/install/install-authorization.service';

class FakeQueryable {
  public readonly statements: string[] = [];
  public readonly params: unknown[][] = [];

  constructor(private readonly rows: Array<{ skill_id: number }>) {}

  async query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.statements.push(text);
    this.params.push((values ?? []) as unknown[]);
    return { rows: this.rows as unknown as T[] };
  }
}

const auth: AuthContext = {
  userId: 7,
  clientDeviceId: 10,
  departmentIds: [2, 3],
  roleCodes: ['normal_user'],
  rawToken: 'token'
};

test('assertSkillUseAllowed checks published status, approved version and separated view/use rules', async () => {
  const queryable = new FakeQueryable([{ skill_id: 100 }]);
  const service = new InstallAuthorizationService();

  await service.assertSkillUseAllowed(queryable, 100, 101, auth);

  assert.equal(queryable.statements.length, 1);
  const sql = queryable.statements[0];
  assert.match(sql, /s\.status = 'published'/);
  assert.match(sql, /sv\.review_status = 'approved'/);
  assert.match(sql, /view_deny_rule\.rule_type = 'view'/);
  assert.match(sql, /view_allow_rule\.rule_type = 'view'/);
  assert.match(sql, /use_deny_rule\.rule_type = 'use'/);
  assert.match(sql, /use_allow_gate\.rule_type = 'use'/);
  assert.match(sql, /use_allow_rule\.rule_type = 'use'/);
  assert.deepEqual(queryable.params[0], [100, 101, 7, [2, 3], ['normal_user']]);
});

test('assertSkillUseAllowed throws PERM_NO_USE_PERMISSION when permission query returns no rows', async () => {
  const queryable = new FakeQueryable([]);
  const service = new InstallAuthorizationService();

  await assert.rejects(
    () => service.assertSkillUseAllowed(queryable, 100, 101, auth),
    (error: unknown) => {
      assert.ok(error instanceof AppException);
      assert.equal(error.code, 'PERM_NO_USE_PERMISSION');
      assert.equal(error.status, 403);
      return true;
    }
  );
});
