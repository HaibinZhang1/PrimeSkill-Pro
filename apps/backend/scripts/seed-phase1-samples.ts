import { existsSync } from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';

import {
  buildArtifactPackage,
  buildInternalArtifactUrl,
  resolvePublicApiBaseUrl
} from '../src/modules/skills/artifact-package.util';

function loadLocalEnvFiles() {
  const processWithEnvLoader = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  const packageRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(packageRoot, '..', '..');

  for (const envFile of [
    path.join(workspaceRoot, '.env'),
    path.join(workspaceRoot, '.env.local'),
    path.join(packageRoot, '.env'),
    path.join(packageRoot, '.env.local')
  ]) {
    if (existsSync(envFile)) {
      processWithEnvLoader.loadEnvFile?.(envFile);
    }
  }
}

type SampleSkill = {
  skillKey: string;
  name: string;
  summary: string;
  description: string;
  visibilityType: 'public' | 'department';
  version: string;
  format: 'zip' | 'legacy_json';
  entries: Array<{ path: string; content: string }>;
  reviewStatus: 'approved' | 'pending';
  skillStatus: 'published' | 'pending_review';
  reviewerUsername?: string;
  searchKeywords?: string;
  aiTools: string[];
  installMode: Record<string, unknown>;
};

const SAMPLE_SKILLS: SampleSkill[] = [
  {
    skillKey: 'sample_cursor_contract_assistant',
    name: '合同规则助手',
    summary: '为 Cursor 项目生成合同评审规则。',
    description: '用于项目级 Cursor 规则安装验证的中文样例 Skill。',
    visibilityType: 'public',
    version: '1.0.0',
    format: 'zip',
    entries: [
      {
        path: 'rule.mdc',
        content: ['# 合同规则助手', '', '- 优先检查字段完整性', '- 输出 JSON 结构建议'].join('\n')
      }
    ],
    reviewStatus: 'approved',
    skillStatus: 'published',
    searchKeywords: 'cursor 合同 规则 审查 json',
    aiTools: ['cursor'],
    installMode: { scope: 'project' }
  },
  {
    skillKey: 'sample_opencode_repo_helper',
    name: '仓库交接助手',
    summary: '为 OpenCode 提供仓库接手与检查模板。',
    description: '用于项目级 OpenCode 安装验证的中文目录型样例 Skill。',
    visibilityType: 'public',
    version: '1.0.0',
    format: 'zip',
    entries: [
      {
        path: 'SKILL.md',
        content: ['# 仓库交接助手', '', '1. 先阅读 README', '2. 再检查 docs/task.md'].join('\n')
      },
      {
        path: 'prompts/review.md',
        content: '请先识别风险，再给出最小改动建议。'
      }
    ],
    reviewStatus: 'approved',
    skillStatus: 'published',
    searchKeywords: 'opencode 仓库 交接 检查',
    aiTools: ['opencode'],
    installMode: { scope: 'project' }
  },
  {
    skillKey: 'sample_pending_release_helper',
    name: '待审核发布助手',
    summary: '用于 admin 审核队列页面的待审核样例。',
    description: '这条记录会保持 pending_review，供最小审核页联调。',
    visibilityType: 'department',
    version: '0.9.0',
    format: 'legacy_json',
    entries: [
      {
        path: 'SKILL.md',
        content: ['# 待审核发布助手', '', '请在发布前确认变更说明、审核意见和安装范围。'].join('\n')
      }
    ],
    reviewStatus: 'pending',
    skillStatus: 'pending_review',
    reviewerUsername: 'sample.reviewer',
    aiTools: ['cursor', 'opencode'],
    installMode: { scope: 'project' }
  }
];

async function main() {
  loadLocalEnvFiles();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://primeskill:primeskill@127.0.0.1:5432/primeskill'
  });

  const publicBaseUrl = resolvePublicApiBaseUrl();

  try {
    await pool.query('BEGIN');

    const departmentId = await upsertDepartment(pool, 'sample-lab', '样例实验室');
    const ownerId = await upsertUser(pool, 'sample.publisher', '样例发布者', 'sample.publisher@example.com', departmentId);
    const reviewerId = await upsertUser(pool, 'sample.reviewer', '样例审核员', 'sample.reviewer@example.com', departmentId);
    const categoryId = await upsertCategory(pool, '样例技能', ownerId);
    const tagIds = await Promise.all(['样例', 'phase1'].map((name) => upsertTag(pool, name, ownerId)));

    for (const sample of SAMPLE_SKILLS) {
      const built = buildArtifactPackage(sample.format, sample.entries);
      const artifactKey = `sva_${sample.skillKey}_${sample.version.replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 64);
      const fileName = `${sample.skillKey}-${sample.version}.${built.fileExtension}`;
      const packageUri = buildInternalArtifactUrl(publicBaseUrl, artifactKey, fileName);

      const skillId = await upsertSkill(pool, {
        skillKey: sample.skillKey,
        name: sample.name,
        summary: sample.summary,
        description: sample.description,
        visibilityType: sample.visibilityType,
        ownerId,
        departmentId,
        categoryId
      });
      await syncSkillTags(pool, skillId, tagIds, ownerId);

      const versionId = await upsertVersion(pool, {
        skillId,
        version: sample.version,
        packageUri,
        checksum: built.checksum,
        reviewStatus: sample.reviewStatus,
        readmeText: sample.entries.find((entry) => entry.path === 'SKILL.md')?.content ?? null,
        aiTools: sample.aiTools,
        installMode: sample.installMode,
        createdBy: ownerId,
        stage1IndexStatus: sample.reviewStatus === 'approved' ? 'ready' : 'pending'
      });

      await upsertArtifact(pool, {
        skillVersionId: versionId,
        artifactKey,
        fileName,
        packageFormat: built.packageFormat,
        mimeType: built.mimeType,
        checksum: built.checksum,
        entryCount: built.entryCount,
        bytes: built.bytes,
        actorUserId: ownerId
      });

      if (sample.skillStatus === 'published') {
        await pool.query(
          `
            UPDATE skill
            SET status = 'published',
                current_version_id = $2,
                updated_at = NOW(),
                updated_by = $3
            WHERE id = $1
          `,
          [skillId, versionId, ownerId]
        );
        await upsertSearchProfile(pool, {
          skillVersionId: versionId,
          title: sample.name,
          summary: sample.summary,
          keywordDocument: sample.searchKeywords ?? `${sample.name} ${sample.summary}`,
          supportedTools: sample.aiTools
        });
      } else {
        await pool.query(
          `
            UPDATE skill
            SET status = 'pending_review',
                current_version_id = NULL,
                updated_at = NOW(),
                updated_by = $2
            WHERE id = $1
          `,
          [skillId, ownerId]
        );
        await ensurePendingReviewTask(pool, versionId, ownerId, sample.reviewerUsername ? reviewerId : null);
      }
    }

    await pool.query('COMMIT');
    console.log(`seeded ${SAMPLE_SKILLS.length} phase1 sample skills`);
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  } finally {
    await pool.end();
  }
}

async function upsertDepartment(pool: Pool, code: string, name: string) {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO department (name, code)
      VALUES ($1, $2)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `,
    [name, code]
  );
  return result.rows[0].id;
}

async function upsertUser(pool: Pool, username: string, displayName: string, email: string, departmentId: number) {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM "user" WHERE username = $1 LIMIT 1`, [username]);
  if (existing.rows[0]) {
    await pool.query(`UPDATE "user" SET display_name = $2, email = $3, department_id = $4 WHERE id = $1`, [
      existing.rows[0].id,
      displayName,
      email,
      departmentId
    ]);
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO "user" (username, display_name, email, department_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [username, displayName, email, departmentId]
  );
  return inserted.rows[0].id;
}

async function upsertCategory(pool: Pool, name: string, actorUserId: number) {
  const existing = await pool.query<{ id: number }>(`SELECT id FROM skill_category WHERE name = $1 LIMIT 1`, [name]);
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO skill_category (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
    [name, actorUserId]
  );
  return inserted.rows[0].id;
}

async function upsertTag(pool: Pool, name: string, actorUserId: number) {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO skill_tag (name, created_by, updated_by)
      VALUES ($1, $2, $2)
      ON CONFLICT (name) DO UPDATE SET updated_at = NOW(), updated_by = EXCLUDED.updated_by
      RETURNING id
    `,
    [name, actorUserId]
  );
  return result.rows[0].id;
}

async function upsertSkill(
  pool: Pool,
  input: {
    skillKey: string;
    name: string;
    summary: string;
    description: string;
    visibilityType: 'public' | 'department';
    ownerId: number;
    departmentId: number;
    categoryId: number;
  }
) {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO skill (skill_key, name, summary, description, owner_user_id, owner_department_id, category_id, visibility_type, status, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $5, $5)
      ON CONFLICT (skill_key) DO UPDATE
      SET name = EXCLUDED.name,
          summary = EXCLUDED.summary,
          description = EXCLUDED.description,
          owner_department_id = EXCLUDED.owner_department_id,
          category_id = EXCLUDED.category_id,
          visibility_type = EXCLUDED.visibility_type,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      RETURNING id
    `,
    [input.skillKey, input.name, input.summary, input.description, input.ownerId, input.departmentId, input.categoryId, input.visibilityType]
  );
  return result.rows[0].id;
}

async function syncSkillTags(pool: Pool, skillId: number, tagIds: number[], actorUserId: number) {
  await pool.query(`DELETE FROM skill_tag_rel WHERE skill_id = $1`, [skillId]);
  await pool.query(`INSERT INTO skill_tag_rel (skill_id, tag_id, created_by) SELECT $1, UNNEST($2::bigint[]), $3`, [
    skillId,
    tagIds,
    actorUserId
  ]);
}

async function upsertVersion(
  pool: Pool,
  input: {
    skillId: number;
    version: string;
    packageUri: string;
    checksum: string;
    reviewStatus: 'approved' | 'pending';
    readmeText: string | null;
    aiTools: string[];
    installMode: Record<string, unknown>;
    createdBy: number;
    stage1IndexStatus: 'ready' | 'pending';
  }
) {
  const result = await pool.query<{ id: number }>(
    `
      INSERT INTO skill_version (
        skill_id, version, package_uri, manifest_json, readme_text, changelog, ai_tools_json, install_mode_json, checksum, review_status, stage1_index_status, stage2_index_status, published_at, search_ready_at, created_by, updated_by
      )
      VALUES (
        $1, $2, $3, '{}'::jsonb, $4, 'phase1 sample seed', $5::jsonb, $6::jsonb, $7, $8, $9, 'pending',
        CASE WHEN $8 = 'approved' THEN NOW() ELSE NULL END,
        CASE WHEN $9 = 'ready' THEN NOW() ELSE NULL END,
        $10, $10
      )
      ON CONFLICT (skill_id, version) DO UPDATE
      SET package_uri = EXCLUDED.package_uri,
          readme_text = EXCLUDED.readme_text,
          changelog = EXCLUDED.changelog,
          ai_tools_json = EXCLUDED.ai_tools_json,
          install_mode_json = EXCLUDED.install_mode_json,
          checksum = EXCLUDED.checksum,
          review_status = EXCLUDED.review_status,
          stage1_index_status = EXCLUDED.stage1_index_status,
          published_at = EXCLUDED.published_at,
          search_ready_at = EXCLUDED.search_ready_at,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      RETURNING id
    `,
    [input.skillId, input.version, input.packageUri, input.readmeText, JSON.stringify(input.aiTools), JSON.stringify(input.installMode), input.checksum, input.reviewStatus, input.stage1IndexStatus, input.createdBy]
  );
  return result.rows[0].id;
}

async function upsertArtifact(
  pool: Pool,
  input: {
    skillVersionId: number;
    artifactKey: string;
    fileName: string;
    packageFormat: 'zip' | 'legacy_json';
    mimeType: string;
    checksum: string;
    entryCount: number;
    bytes: Buffer;
    actorUserId: number;
  }
) {
  await pool.query(
    `
      INSERT INTO skill_version_artifact (
        skill_version_id, artifact_key, storage_kind, package_format, mime_type, file_name, sha256, byte_size, entry_count, package_bytes, created_by, updated_by
      )
      VALUES ($1, $2, 'database_inline', $3, $4, $5, $6, $7, $8, $9, $10, $10)
      ON CONFLICT (skill_version_id) DO UPDATE
      SET artifact_key = EXCLUDED.artifact_key,
          package_format = EXCLUDED.package_format,
          mime_type = EXCLUDED.mime_type,
          file_name = EXCLUDED.file_name,
          sha256 = EXCLUDED.sha256,
          byte_size = EXCLUDED.byte_size,
          entry_count = EXCLUDED.entry_count,
          package_bytes = EXCLUDED.package_bytes,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
    `,
    [input.skillVersionId, input.artifactKey, input.packageFormat, input.mimeType, input.fileName, input.checksum, input.bytes.length, input.entryCount, input.bytes, input.actorUserId]
  );
}

async function upsertSearchProfile(
  pool: Pool,
  input: {
    skillVersionId: number;
    title: string;
    summary: string;
    keywordDocument: string;
    supportedTools: string[];
  }
) {
  await pool.query(
    `
      INSERT INTO skill_search_profile (skill_version_id, title_text, summary_text, keyword_document, supported_tools_json, metadata_json)
      VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb)
      ON CONFLICT (skill_version_id) DO UPDATE
      SET title_text = EXCLUDED.title_text,
          summary_text = EXCLUDED.summary_text,
          keyword_document = EXCLUDED.keyword_document,
          supported_tools_json = EXCLUDED.supported_tools_json,
          updated_at = NOW()
    `,
    [input.skillVersionId, input.title, input.summary, input.keywordDocument, JSON.stringify(input.supportedTools)]
  );
}

async function ensurePendingReviewTask(pool: Pool, skillVersionId: number, submitterId: number, reviewerId: number | null) {
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM review_task WHERE skill_version_id = $1 AND status IN ('created', 'assigned', 'in_review') LIMIT 1`,
    [skillVersionId]
  );
  if (existing.rows[0]) {
    return;
  }

  await pool.query(
    `
      INSERT INTO review_task (skill_version_id, submitter_id, reviewer_id, review_round, status, comment, created_by, updated_by)
      VALUES ($1, $2, $3, 1, $4, 'phase1 sample seed', $2, $2)
    `,
    [skillVersionId, submitterId, reviewerId, reviewerId ? 'assigned' : 'created']
  );
}

main().catch((error) => {
  console.error('seed phase1 samples failed', error);
  process.exit(1);
});
