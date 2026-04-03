import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import type { AuthContext } from '../../common/http.types';
import { SkillArtifactService } from './skill-artifact.service';
import type {
  AdminArtifactSummary,
  AdminSkillEditorOptionsResponse,
  AdminReviewQueueItem,
  AdminReviewQueueQueryDto,
  AdminReviewTaskSummary,
  AdminSkillDetailResponse,
  AdminSkillListItem,
  AdminSkillListQueryDto,
  AdminSkillVersionSummary
} from './skill.types';

const ADMIN_READER_ROLES = new Set(['platform_admin', 'security_admin', 'dept_admin', 'reviewer']);

interface ArtifactSummaryRow {
  package_uri: string;
  checksum: string;
  package_format: 'zip' | 'legacy_json' | null;
  file_name: string | null;
  byte_size: number | null;
  entry_count: number | null;
}

interface SkillListRow extends ArtifactSummaryRow {
  skill_id: number;
  skill_key: string;
  name: string;
  summary: string | null;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  visibility_type: 'public' | 'department' | 'private';
  owner_user_id: number;
  owner_display_name: string | null;
  owner_department_id: number | null;
  owner_department_name: string | null;
  category_name: string | null;
  updated_at: Date;
  skill_version_id: number | null;
  version: string | null;
  review_status: 'pending' | 'approved' | 'rejected' | null;
  published_at: Date | null;
  version_created_at: Date | null;
  active_review_task_id: number | null;
  active_review_task_status: 'created' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'closed' | null;
  active_review_round: number | null;
  active_review_submitter_id: number | null;
  active_review_submitter_name: string | null;
  active_review_reviewer_id: number | null;
  active_review_reviewer_name: string | null;
  active_review_comment: string | null;
  active_review_created_at: Date | null;
  active_review_reviewed_at: Date | null;
}

interface SkillDetailRow {
  skill_id: number;
  skill_key: string;
  name: string;
  summary: string | null;
  description: string | null;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  visibility_type: 'public' | 'department' | 'private';
  owner_user_id: number;
  owner_display_name: string | null;
  owner_department_id: number | null;
  owner_department_name: string | null;
  category_name: string | null;
  updated_at: Date;
}

interface SkillTagRow {
  tag_id: number;
  name: string;
}

interface SkillOptionRow {
  id: number;
  name: string;
}

interface VersionRow extends ArtifactSummaryRow {
  skill_version_id: number;
  version: string;
  review_status: 'pending' | 'approved' | 'rejected';
  published_at: Date | null;
  created_at: Date;
}

interface ReviewRow {
  review_task_id: number;
  skill_version_id: number;
  version: string;
  review_status: 'pending' | 'approved' | 'rejected';
  task_status: 'created' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'closed';
  review_round: number;
  submitter_id: number;
  submitter_display_name: string | null;
  reviewer_id: number | null;
  reviewer_display_name: string | null;
  comment: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

interface ReviewQueueRow extends ReviewRow, ArtifactSummaryRow {
  skill_id: number;
  skill_key: string;
  skill_name: string;
  skill_status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  owner_department_id: number | null;
  owner_department_name: string | null;
}

@Injectable()
export class SkillAdminService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SkillArtifactService) private readonly skillArtifactService: SkillArtifactService
  ) {}

  async listSkills(query: AdminSkillListQueryDto, auth: AuthContext | undefined): Promise<{ items: AdminSkillListItem[] }> {
    const actor = this.requireAdminReadAuth(auth);
    const scope = this.buildScope(actor, 's');
    const params = [...scope.params] as unknown[];
    const conditions = [scope.whereSql];

    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const index = params.length;
      conditions.push(`(s.skill_key ILIKE $${index} OR s.name ILIKE $${index} OR COALESCE(s.summary, '') ILIKE $${index})`);
    }
    if (query.skillStatus) {
      params.push(query.skillStatus);
      conditions.push(`s.status = $${params.length}`);
    }
    if (query.reviewStatus) {
      params.push(query.reviewStatus);
      conditions.push(`cv.review_status = $${params.length}`);
    }

    params.push(Math.min(query.limit ?? 50, 100));

    const result = await this.db.query<SkillListRow>(
      `
        SELECT
          s.id AS skill_id,
          s.skill_key,
          s.name,
          s.summary,
          s.status,
          s.visibility_type,
          s.owner_user_id,
          owner.display_name AS owner_display_name,
          s.owner_department_id,
          dept.name AS owner_department_name,
          cat.name AS category_name,
          s.updated_at,
          cv.skill_version_id,
          cv.version,
          cv.review_status,
          cv.package_uri,
          cv.checksum,
          cv.published_at,
          cv.version_created_at,
          sva.package_format,
          sva.file_name,
          sva.byte_size,
          sva.entry_count,
          art.review_task_id AS active_review_task_id,
          art.task_status AS active_review_task_status,
          art.review_round AS active_review_round,
          art.submitter_id AS active_review_submitter_id,
          art.submitter_display_name AS active_review_submitter_name,
          art.reviewer_id AS active_review_reviewer_id,
          art.reviewer_display_name AS active_review_reviewer_name,
          art.comment AS active_review_comment,
          art.created_at AS active_review_created_at,
          art.reviewed_at AS active_review_reviewed_at
        FROM skill s
        LEFT JOIN "user" owner ON owner.id = s.owner_user_id
        LEFT JOIN department dept ON dept.id = s.owner_department_id
        LEFT JOIN skill_category cat ON cat.id = s.category_id
        LEFT JOIN LATERAL (
          SELECT
            sv.id AS skill_version_id,
            sv.version,
            sv.review_status,
            sv.package_uri,
            sv.checksum,
            sv.published_at,
            sv.created_at AS version_created_at
          FROM skill_version sv
          WHERE sv.skill_id = s.id
          ORDER BY CASE WHEN s.current_version_id = sv.id THEN 0 ELSE 1 END, sv.created_at DESC, sv.id DESC
          LIMIT 1
        ) cv ON TRUE
        LEFT JOIN skill_version_artifact sva ON sva.skill_version_id = cv.skill_version_id
        LEFT JOIN LATERAL (
          SELECT
            rt.id AS review_task_id,
            rt.status AS task_status,
            rt.review_round,
            rt.submitter_id,
            submitter.display_name AS submitter_display_name,
            rt.reviewer_id,
            reviewer.display_name AS reviewer_display_name,
            rt.comment,
            rt.created_at,
            rt.reviewed_at
          FROM review_task rt
          JOIN skill_version sv ON sv.id = rt.skill_version_id
          LEFT JOIN "user" submitter ON submitter.id = rt.submitter_id
          LEFT JOIN "user" reviewer ON reviewer.id = rt.reviewer_id
          WHERE sv.skill_id = s.id
            AND rt.status IN ('created', 'assigned', 'in_review')
          ORDER BY rt.created_at DESC, rt.id DESC
          LIMIT 1
        ) art ON TRUE
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY s.updated_at DESC, s.id DESC
        LIMIT $${params.length}
      `,
      params
    );

    return {
      items: result.rows.map((row) => ({
        skillId: row.skill_id,
        skillKey: row.skill_key,
        name: row.name,
        summary: row.summary ?? undefined,
        status: row.status,
        visibilityType: row.visibility_type,
        ownerUserId: row.owner_user_id,
        ownerDisplayName: row.owner_display_name ?? undefined,
        ownerDepartmentId: row.owner_department_id ?? undefined,
        ownerDepartmentName: row.owner_department_name ?? undefined,
        categoryName: row.category_name ?? undefined,
        updatedAt: row.updated_at.toISOString(),
        currentVersion: row.skill_version_id && row.version && row.review_status ? this.mapVersion(row) : undefined,
        activeReviewTask: row.active_review_task_id ? this.mapActiveReview(row) : undefined
      }))
    };
  }

  async getSkillDetail(skillId: number, auth: AuthContext | undefined): Promise<AdminSkillDetailResponse> {
    const actor = this.requireAdminReadAuth(auth);
    const scope = this.buildScope(actor, 's');
    const core = await this.db.query<SkillDetailRow>(
      `
        SELECT
          s.id AS skill_id,
          s.skill_key,
          s.name,
          s.summary,
          s.description,
          s.status,
          s.visibility_type,
          s.owner_user_id,
          owner.display_name AS owner_display_name,
          s.owner_department_id,
          dept.name AS owner_department_name,
          cat.name AS category_name,
          s.updated_at
        FROM skill s
        LEFT JOIN "user" owner ON owner.id = s.owner_user_id
        LEFT JOIN department dept ON dept.id = s.owner_department_id
        LEFT JOIN skill_category cat ON cat.id = s.category_id
        WHERE s.id = $1
          AND ${scope.whereSql}
        LIMIT 1
      `,
      [skillId, ...scope.params]
    );
    const skill = core.rows[0];
    if (!skill) {
      throw new AppException('SKILL_NOT_FOUND', 404, 'skill not found');
    }

    const [tags, versions, reviews] = await Promise.all([
      this.db.query<SkillTagRow>(
        `SELECT st.id AS tag_id, st.name FROM skill_tag_rel rel JOIN skill_tag st ON st.id = rel.tag_id WHERE rel.skill_id = $1 ORDER BY st.name ASC`,
        [skillId]
      ),
      this.db.query<VersionRow>(
        `
          SELECT
            sv.id AS skill_version_id,
            sv.version,
            sv.review_status,
            sv.package_uri,
            sv.checksum,
            sv.published_at,
            sv.created_at,
            sva.package_format,
            sva.file_name,
            sva.byte_size,
            sva.entry_count
          FROM skill_version sv
          LEFT JOIN skill_version_artifact sva ON sva.skill_version_id = sv.id
          WHERE sv.skill_id = $1
          ORDER BY sv.created_at DESC, sv.id DESC
        `,
        [skillId]
      ),
      this.db.query<ReviewRow>(
        `
          SELECT
            rt.id AS review_task_id,
            rt.skill_version_id,
            sv.version,
            sv.review_status,
            rt.status AS task_status,
            rt.review_round,
            rt.submitter_id,
            submitter.display_name AS submitter_display_name,
            rt.reviewer_id,
            reviewer.display_name AS reviewer_display_name,
            rt.comment,
            rt.created_at,
            rt.reviewed_at
          FROM review_task rt
          JOIN skill_version sv ON sv.id = rt.skill_version_id
          LEFT JOIN "user" submitter ON submitter.id = rt.submitter_id
          LEFT JOIN "user" reviewer ON reviewer.id = rt.reviewer_id
          WHERE sv.skill_id = $1
          ORDER BY rt.created_at DESC, rt.id DESC
        `,
        [skillId]
      )
    ]);

    return {
      skillId: skill.skill_id,
      skillKey: skill.skill_key,
      name: skill.name,
      summary: skill.summary ?? undefined,
      description: skill.description ?? undefined,
      status: skill.status,
      visibilityType: skill.visibility_type,
      ownerUserId: skill.owner_user_id,
      ownerDisplayName: skill.owner_display_name ?? undefined,
      ownerDepartmentId: skill.owner_department_id ?? undefined,
      ownerDepartmentName: skill.owner_department_name ?? undefined,
      categoryName: skill.category_name ?? undefined,
      tags: tags.rows.map((row) => ({ tagId: row.tag_id, name: row.name })),
      versions: versions.rows.map((row) => this.mapVersion(row)),
      reviewTasks: reviews.rows.map((row) => this.mapReview(row)),
      updatedAt: skill.updated_at.toISOString()
    };
  }

  async listReviewQueue(
    query: AdminReviewQueueQueryDto,
    auth: AuthContext | undefined
  ): Promise<{ items: AdminReviewQueueItem[] }> {
    const actor = this.requireAdminReadAuth(auth);
    const scope = this.buildScope(actor, 's');
    const params = [...scope.params, Math.min(query.limit ?? 50, 100)];

    const result = await this.db.query<ReviewQueueRow>(
      `
        SELECT
          rt.id AS review_task_id,
          rt.skill_version_id,
          sv.version,
          sv.review_status,
          rt.status AS task_status,
          rt.review_round,
          rt.submitter_id,
          submitter.display_name AS submitter_display_name,
          rt.reviewer_id,
          reviewer.display_name AS reviewer_display_name,
          rt.comment,
          rt.created_at,
          rt.reviewed_at,
          s.id AS skill_id,
          s.skill_key,
          s.name AS skill_name,
          s.status AS skill_status,
          s.owner_department_id,
          dept.name AS owner_department_name,
          sv.package_uri,
          sv.checksum,
          sva.package_format,
          sva.file_name,
          sva.byte_size,
          sva.entry_count
        FROM review_task rt
        JOIN skill_version sv ON sv.id = rt.skill_version_id
        JOIN skill s ON s.id = sv.skill_id
        LEFT JOIN department dept ON dept.id = s.owner_department_id
        LEFT JOIN "user" submitter ON submitter.id = rt.submitter_id
        LEFT JOIN "user" reviewer ON reviewer.id = rt.reviewer_id
        LEFT JOIN skill_version_artifact sva ON sva.skill_version_id = sv.id
        WHERE rt.status IN ('created', 'assigned', 'in_review')
          AND ${scope.whereSql}
        ORDER BY rt.created_at ASC, rt.id ASC
        LIMIT $${params.length}
      `,
      params
    );

    return {
      items: result.rows.map((row) => ({
        ...this.mapReview(row),
        skillId: row.skill_id,
        skillKey: row.skill_key,
        skillName: row.skill_name,
        skillStatus: row.skill_status,
        ownerDepartmentId: row.owner_department_id ?? undefined,
        ownerDepartmentName: row.owner_department_name ?? undefined,
        artifact: this.mapArtifact(row)
      }))
    };
  }

  async listSkillEditorOptions(auth: AuthContext | undefined): Promise<AdminSkillEditorOptionsResponse> {
    this.requireAdminReadAuth(auth);

    const [categories, tags] = await Promise.all([
      this.db.query<SkillOptionRow>(`SELECT id, name FROM skill_category ORDER BY name ASC, id ASC`),
      this.db.query<SkillOptionRow>(`SELECT id, name FROM skill_tag ORDER BY name ASC, id ASC`)
    ]);

    return {
      categories: categories.rows.map((row) => ({
        id: row.id,
        name: row.name
      })),
      tags: tags.rows.map((row) => ({
        id: row.id,
        name: row.name
      }))
    };
  }

  async downloadArtifact(artifactKey: string) {
    const artifact = await this.skillArtifactService.loadArtifactForDownload(artifactKey);
    return {
      bytes: artifact.package_bytes,
      byteSize: artifact.byte_size,
      fileName: artifact.file_name,
      mimeType: artifact.mime_type,
      sha256: artifact.sha256
    };
  }

  private requireAdminReadAuth(auth: AuthContext | undefined) {
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }
    if (!auth.roleCodes.some((role) => ADMIN_READER_ROLES.has(role))) {
      throw new AppException('PERM_ROLE_FORBIDDEN', 403, 'role forbidden');
    }
    return auth;
  }

  private buildScope(auth: AuthContext, alias: string) {
    if (auth.roleCodes.includes('platform_admin') || auth.roleCodes.includes('security_admin') || auth.roleCodes.includes('reviewer')) {
      return { whereSql: '1=1', params: [] as unknown[] };
    }
    return {
      whereSql: `${alias}.owner_department_id = ANY($1::bigint[])`,
      params: [auth.departmentIds] as unknown[]
    };
  }

  private mapArtifact(row: ArtifactSummaryRow): AdminArtifactSummary {
    return {
      packageSource: row.package_format ? 'internal' : 'external',
      packageUri: row.package_uri,
      checksum: row.checksum,
      packageFormat: row.package_format ?? undefined,
      fileName: row.file_name ?? undefined,
      byteSize: row.byte_size ?? undefined,
      entryCount: row.entry_count ?? undefined
    };
  }

  private mapVersion(row: VersionRow | SkillListRow): AdminSkillVersionSummary {
    const createdAt = 'version_created_at' in row ? row.version_created_at : row.created_at;
    return {
      skillVersionId: row.skill_version_id!,
      version: row.version!,
      reviewStatus: row.review_status!,
      packageUri: row.package_uri,
      checksum: row.checksum,
      publishedAt: row.published_at?.toISOString(),
      createdAt: createdAt!.toISOString(),
      artifact: this.mapArtifact(row)
    };
  }

  private mapReview(row: ReviewRow | ReviewQueueRow): AdminReviewTaskSummary {
    return {
      reviewTaskId: row.review_task_id,
      skillVersionId: row.skill_version_id,
      version: row.version,
      reviewStatus: row.review_status,
      taskStatus: row.task_status,
      reviewRound: row.review_round,
      submitterId: row.submitter_id,
      submitterDisplayName: row.submitter_display_name ?? undefined,
      reviewerId: row.reviewer_id ?? undefined,
      reviewerDisplayName: row.reviewer_display_name ?? undefined,
      comment: row.comment ?? undefined,
      createdAt: row.created_at.toISOString(),
      reviewedAt: row.reviewed_at?.toISOString()
    };
  }

  private mapActiveReview(row: SkillListRow): AdminReviewTaskSummary {
    return {
      reviewTaskId: row.active_review_task_id!,
      skillVersionId: row.skill_version_id!,
      version: row.version!,
      reviewStatus: row.review_status!,
      taskStatus: row.active_review_task_status!,
      reviewRound: row.active_review_round!,
      submitterId: row.active_review_submitter_id!,
      submitterDisplayName: row.active_review_submitter_name ?? undefined,
      reviewerId: row.active_review_reviewer_id ?? undefined,
      reviewerDisplayName: row.active_review_reviewer_name ?? undefined,
      comment: row.active_review_comment ?? undefined,
      createdAt: row.active_review_created_at!.toISOString(),
      reviewedAt: row.active_review_reviewed_at?.toISOString()
    };
  }
}
