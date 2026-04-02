import type { PoolClient } from 'pg';

import type { Stage1IndexJob, Stage2IndexJob } from './jobs/contracts';
import { WorkerDb } from './worker-db';
import type { EmbeddingProvider } from './embedding/provider';

function toPgVector(values: number[]): string {
  return `[${values.join(',')}]`;
}

function splitChunks(content: string): string[] {
  const raw = content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : [content.trim()].filter(Boolean);
}

export class StageWorker {
  constructor(
    private readonly db: WorkerDb,
    private readonly embeddingProvider: EmbeddingProvider
  ) {}

  async processStage1(job: Stage1IndexJob) {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE skill_version SET stage1_index_status = 'processing', updated_at = NOW() WHERE id = $1`,
        [job.skillVersionId]
      );

      const versionResult = await tx.query<{
        skill_id: number;
        skill_name: string;
        summary: string | null;
        version: string;
        ai_tools_json: string[];
      }>(
        `
          SELECT
            sv.skill_id,
            s.name AS skill_name,
            s.summary,
            sv.version,
            ARRAY(SELECT jsonb_array_elements_text(sv.ai_tools_json)) AS ai_tools_json
          FROM skill_version sv
          JOIN skill s ON s.id = sv.skill_id
          WHERE sv.id = $1
        `,
        [job.skillVersionId]
      );

      const version = versionResult.rows[0];
      if (!version) {
        throw new Error(`skill version not found: ${job.skillVersionId}`);
      }

      const tagResult = await tx.query<{ tags: string[] }>(
        `
          SELECT ARRAY_REMOVE(ARRAY_AGG(st.name), NULL) AS tags
          FROM skill_tag_rel rel
          JOIN skill_tag st ON st.id = rel.tag_id
          WHERE rel.skill_id = $1
        `,
        [version.skill_id]
      );
      const tags = tagResult.rows[0]?.tags ?? [];
      const keywordDocument = [version.skill_name, version.summary ?? '', tags.join(' '), version.version].join(' ').trim();
      const embedding = await this.embeddingProvider.embed(keywordDocument);

      await tx.query(
        `
          INSERT INTO skill_search_profile (
            skill_version_id,
            title_text,
            summary_text,
            tag_text,
            category_text,
            supported_tools_json,
            keyword_document,
            metadata_json,
            head_embedding,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, '',
            $5::jsonb, $6, $7::jsonb, $8::vector,
            NOW(), NOW()
          )
          ON CONFLICT (skill_version_id) DO UPDATE
          SET title_text = EXCLUDED.title_text,
              summary_text = EXCLUDED.summary_text,
              tag_text = EXCLUDED.tag_text,
              supported_tools_json = EXCLUDED.supported_tools_json,
              keyword_document = EXCLUDED.keyword_document,
              metadata_json = EXCLUDED.metadata_json,
              head_embedding = EXCLUDED.head_embedding,
              updated_at = NOW()
        `,
        [
          job.skillVersionId,
          version.skill_name,
          version.summary,
          tags.join(' '),
          JSON.stringify(version.ai_tools_json ?? []),
          keywordDocument,
          JSON.stringify({ traceId: job.traceId, source: 'stage1' }),
          toPgVector(embedding)
        ]
      );

      await tx.query(
        `
          UPDATE skill_version
          SET stage1_index_status = 'ready',
              updated_at = NOW(),
              search_ready_at = CASE WHEN stage2_index_status = 'ready' THEN NOW() ELSE search_ready_at END
          WHERE id = $1
        `,
        [job.skillVersionId]
      );
    });
  }

  async processStage2(job: Stage2IndexJob) {
    await this.db.withTransaction(async (tx) => {
      await tx.query(
        `UPDATE skill_version SET stage2_index_status = 'processing', updated_at = NOW() WHERE id = $1`,
        [job.skillVersionId]
      );

      const versionResult = await tx.query<{
        readme_text: string | null;
        manifest_json: Record<string, unknown>;
      }>(
        `
          SELECT readme_text, manifest_json
          FROM skill_version
          WHERE id = $1
        `,
        [job.skillVersionId]
      );
      const version = versionResult.rows[0];
      if (!version) {
        throw new Error(`skill version not found: ${job.skillVersionId}`);
      }

      const fallback = JSON.stringify(version.manifest_json ?? {});
      const sourceText = version.readme_text?.trim() || fallback;
      const chunks = splitChunks(sourceText);

      await tx.query(`DELETE FROM skill_document WHERE skill_version_id = $1`, [job.skillVersionId]);
      await this.insertChunks(tx, job.skillVersionId, chunks, job.traceId);

      await tx.query(
        `
          UPDATE skill_version
          SET stage2_index_status = 'ready',
              updated_at = NOW(),
              search_ready_at = CASE WHEN stage1_index_status = 'ready' THEN NOW() ELSE search_ready_at END
          WHERE id = $1
        `,
        [job.skillVersionId]
      );
    });
  }

  private async insertChunks(
    tx: PoolClient,
    skillVersionId: number,
    chunks: string[],
    traceId: string
  ) {
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = await this.embeddingProvider.embed(chunk);
      const tokenCount = chunk.split(/\s+/).filter(Boolean).length;

      await tx.query(
        `
          INSERT INTO skill_document (
            skill_version_id,
            chunk_index,
            content,
            token_count,
            metadata_json,
            embedding,
            created_at
          )
          VALUES (
            $1, $2, $3, $4, $5::jsonb, $6::vector, NOW()
          )
        `,
        [skillVersionId, i, chunk, tokenCount, JSON.stringify({ traceId, chunkPolicy: 'paragraph' }), toPgVector(embedding)]
      );
    }
  }
}
