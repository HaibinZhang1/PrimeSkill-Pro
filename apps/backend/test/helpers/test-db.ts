import { readFile } from 'fs/promises';
import path from 'path';

import { Pool, type QueryResult, type QueryResultRow, types } from 'pg';
import Redis from 'ioredis';

types.setTypeParser(20, (value) => Number(value));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://primeskill:primeskill@127.0.0.1:5432/primeskill'
});

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1
});

const MIGRATIONS = [
  'M001_extensions.sql',
  'M002_iam_org.sql',
  'M003_skill_review.sql',
  'M004_tool_template.sql',
  'M005_device_workspace.sql',
  'M006_install_governance.sql',
  'M007_search_indexes.sql',
  'M008_audit_seed.sql',
  'M009_constraints_finalize.sql'
];
const RESET_DB_LOCK_KEY = 9020401;

function migrationPath(name: string): string {
  return path.resolve(__dirname, '../../../../infra/db/migrations', name);
}

export async function resetDatabase() {
  await pool.query('SELECT pg_advisory_lock($1)', [RESET_DB_LOCK_KEY]);
  try {
    await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);

    for (const migration of MIGRATIONS) {
      const sql = await readFile(migrationPath(migration), 'utf8');
      await pool.query(sql);
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [RESET_DB_LOCK_KEY]);
  }
}

export async function flushRedis() {
  if (redis.status === 'wait') {
    await redis.connect();
  }
  await redis.flushall();
}

export async function queryDb<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, params);
}

export async function closeInfra() {
  if (redis.status !== 'end') {
    await redis.quit();
  }
  await pool.end();
}
