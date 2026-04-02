import { Pool, type PoolClient, type QueryResult, type QueryResultRow, types } from 'pg';

export class WorkerDb {
  private readonly pool: Pool;

  constructor(connectionString = process.env.DATABASE_URL ?? 'postgresql://primeskill:primeskill@127.0.0.1:5432/primeskill') {
    types.setTypeParser(20, (value) => Number(value));
    this.pool = new Pool({ connectionString });
  }

  async query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async withTransaction<T>(runner: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await runner(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
