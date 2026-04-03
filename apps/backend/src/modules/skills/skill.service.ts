import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import type { AuthContext } from '../../common/http.types';
import { buildArtifactPackage } from './artifact-package.util';
import { SkillArtifactService } from './skill-artifact.service';
import { SkillIndexQueueService } from './skill-index-queue.service';
import type {
  ApproveReviewRequestDto,
  ApproveReviewResponse,
  CreateSkillRequestDto,
  CreateSkillResponse,
  CreateSkillVersionRequestDto,
  CreateSkillVersionResponse,
  SubmitSkillReviewRequestDto,
  SubmitSkillReviewResponse
} from './skill.types';

const SKILL_ADMIN_ROLES = new Set(['platform_admin', 'security_admin']);
const SKILL_DEPARTMENT_MANAGER_ROLES = new Set(['dept_admin']);
const ACTIVE_REVIEW_TASK_STATUSES = ['created', 'assigned', 'in_review'];

interface SkillRow {
  id: number;
  skill_key: string;
  owner_user_id: number;
  owner_department_id: number | null;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
}

interface SkillVersionRow {
  id: number;
  skill_id: number;
  review_status: 'pending' | 'approved' | 'rejected';
}

interface ReviewTaskContextRow {
  review_task_id: number;
  review_task_status: 'created' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'closed';
  reviewer_id: number | null;
  submitter_id: number;
  skill_id: number;
  skill_status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  skill_version_id: number;
  review_status: 'pending' | 'approved' | 'rejected';
}

@Injectable()
export class SkillService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SkillIndexQueueService) private readonly skillIndexQueueService: SkillIndexQueueService,
    @Inject(SkillArtifactService) private readonly skillArtifactService: SkillArtifactService
  ) {}

  async createSkill(input: CreateSkillRequestDto, auth: AuthContext): Promise<CreateSkillResponse> {
    const tagIds = [...new Set(input.tagIds ?? [])];
    const ownerDepartmentId = auth.departmentIds[0] ?? null;

    return this.db.withTransaction(async (tx) => {
      await this.assertCategoryExists(tx, input.categoryId);
      await this.assertTagsExist(tx, tagIds);

      try {
        const result = await tx.query<{ id: number; status: 'draft' }>(
          `
            INSERT INTO skill (
              skill_key,
              name,
              summary,
              description,
              owner_user_id,
              owner_department_id,
              category_id,
              status,
              visibility_type,
              created_by,
              updated_by
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, 'draft', $8, $5, $5
            )
            RETURNING id, status
          `,
          [
            input.skillKey,
            input.name,
            input.summary ?? null,
            input.description ?? null,
            auth.userId,
            ownerDepartmentId,
            input.categoryId ?? null,
            input.visibilityType
          ]
        );

        const skillId = result.rows[0].id;
        await this.insertTags(tx, skillId, tagIds, auth.userId);

        return {
          skillId,
          status: result.rows[0].status
        };
      } catch (error) {
        this.rethrowKnownDatabaseErrors(error, {
          skill_skill_key_key: new AppException('SKILL_KEY_EXISTS', 409, 'skill key already exists')
        });
        throw error;
      }
    });
  }

  async createVersion(
    skillId: number,
    input: CreateSkillVersionRequestDto,
    auth: AuthContext
  ): Promise<CreateSkillVersionResponse> {
    return this.db.withTransaction(async (tx) => {
      const skill = await this.loadSkillForUpdate(tx, skillId);
      this.assertSkillManageAllowed(skill, auth);

      if (skill.status === 'archived') {
        throw new AppException('SKILL_STATUS_CONFLICT', 409, 'archived skill cannot accept new versions');
      }

      const packageInput = this.resolveVersionPackageInput(skill.skill_key, input);

      try {
        const inserted = await tx.query<{
          id: number;
          review_status: 'pending';
          stage1_index_status: 'pending';
          stage2_index_status: 'pending';
        }>(
          `
            INSERT INTO skill_version (
              skill_id,
              version,
              package_uri,
              manifest_json,
              readme_text,
              changelog,
              ai_tools_json,
              install_mode_json,
              checksum,
              signature,
              review_status,
              stage1_index_status,
              stage2_index_status,
              created_by,
              updated_by
            )
            VALUES (
              $1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9, $10,
              'pending', 'pending', 'pending', $11, $11
            )
            RETURNING id, review_status, stage1_index_status, stage2_index_status
          `,
          [
            skillId,
            input.version,
            packageInput.packageUri,
            JSON.stringify(input.manifestJson ?? {}),
            input.readmeText ?? null,
            input.changelog ?? null,
            JSON.stringify(input.aiToolsJson ?? []),
            JSON.stringify(input.installModeJson ?? {}),
            packageInput.checksum,
            input.signature ?? null,
            auth.userId
          ]
        );

        if (packageInput.internalArtifact) {
          await this.skillArtifactService.createArtifact(tx, {
            skillVersionId: inserted.rows[0].id,
            artifactKey: packageInput.internalArtifact.artifactKey,
            fileName: packageInput.internalArtifact.fileName,
            built: packageInput.internalArtifact.built,
            actorUserId: auth.userId
          });
        }

        return {
          skillVersionId: inserted.rows[0].id,
          reviewStatus: inserted.rows[0].review_status,
          stage1IndexStatus: inserted.rows[0].stage1_index_status,
          stage2IndexStatus: inserted.rows[0].stage2_index_status,
          packageUri: packageInput.packageUri,
          checksum: packageInput.checksum,
          packageSource: packageInput.packageSource
        };
      } catch (error) {
        this.rethrowKnownDatabaseErrors(error, {
          skill_version_skill_id_version_key: new AppException('SKILL_VERSION_EXISTS', 409, 'skill version already exists')
        });
        throw error;
      }
    });
  }

  async submitReview(
    skillId: number,
    input: SubmitSkillReviewRequestDto,
    auth: AuthContext
  ): Promise<SubmitSkillReviewResponse> {
    return this.db.withTransaction(async (tx) => {
      const skill = await this.loadSkillForUpdate(tx, skillId);
      this.assertSkillManageAllowed(skill, auth);

      const version = await this.loadSkillVersionForUpdate(tx, input.skillVersionId, skillId);
      if (version.review_status === 'approved') {
        throw new AppException('REVIEW_TASK_STATUS_CONFLICT', 409, 'skill version is already approved');
      }

      if (input.reviewerId) {
        if (input.reviewerId === auth.userId) {
          throw new AppException('REVIEW_SELF_APPROVAL_FORBIDDEN', 409, 'submitter cannot review the same task');
        }
        await this.assertUserExists(tx, input.reviewerId, 'REVIEWER_NOT_FOUND', 'reviewer not found');
      }

      const activeTask = await tx.query<{ id: number }>(
        `
          SELECT id
          FROM review_task
          WHERE skill_version_id = $1
            AND status = ANY($2::varchar[])
          LIMIT 1
        `,
        [input.skillVersionId, ACTIVE_REVIEW_TASK_STATUSES]
      );
      if (activeTask.rows.length > 0) {
        throw new AppException('REVIEW_TASK_ALREADY_OPEN', 409, 'an active review task already exists');
      }

      const roundResult = await tx.query<{ next_round: number }>(
        `
          SELECT COALESCE(MAX(review_round), 0) + 1 AS next_round
          FROM review_task
          WHERE skill_version_id = $1
        `,
        [input.skillVersionId]
      );
      const reviewRound = roundResult.rows[0].next_round;
      const taskStatus: 'created' | 'assigned' = input.reviewerId ? 'assigned' : 'created';

      const inserted = await tx.query<{ id: number }>(
        `
          INSERT INTO review_task (
            skill_version_id,
            submitter_id,
            reviewer_id,
            review_round,
            status,
            comment,
            created_by,
            updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $2, $2)
          RETURNING id
        `,
        [input.skillVersionId, auth.userId, input.reviewerId ?? null, reviewRound, taskStatus, input.comment ?? null]
      );

      await tx.query(
        `
          UPDATE skill_version
          SET review_status = 'pending',
              updated_at = NOW(),
              updated_by = $2
          WHERE id = $1
        `,
        [input.skillVersionId, auth.userId]
      );

      if (skill.status !== 'published') {
        await tx.query(
          `
            UPDATE skill
            SET status = 'pending_review',
                updated_at = NOW(),
                updated_by = $2
            WHERE id = $1
          `,
          [skillId, auth.userId]
        );
      }

      return {
        reviewTaskId: inserted.rows[0].id,
        status: taskStatus,
        reviewRound
      };
    });
  }

  async approveReview(
    reviewTaskId: number,
    input: ApproveReviewRequestDto,
    auth: AuthContext,
    traceId: string
  ): Promise<ApproveReviewResponse> {
    const approval = await this.db.withTransaction(async (tx) => {
      const context = await this.loadReviewTaskContextForUpdate(tx, reviewTaskId);

      if (context.review_task_status === 'approved' || context.review_task_status === 'closed') {
        throw new AppException('REVIEW_TASK_STATUS_CONFLICT', 409, 'review task is already closed');
      }
      if (context.review_task_status === 'rejected') {
        throw new AppException('REVIEW_TASK_STATUS_CONFLICT', 409, 'rejected review task cannot be approved directly');
      }
      if (context.review_status === 'approved') {
        throw new AppException('REVIEW_TASK_STATUS_CONFLICT', 409, 'skill version is already approved');
      }
      if (context.skill_status === 'archived') {
        throw new AppException('SKILL_STATUS_CONFLICT', 409, 'archived skill cannot be published');
      }
      if (context.submitter_id === auth.userId) {
        throw new AppException('REVIEW_SELF_APPROVAL_FORBIDDEN', 409, 'submitter cannot approve the same review task');
      }

      const isAdmin = this.hasSkillAdminRole(auth);
      if (context.reviewer_id && context.reviewer_id !== auth.userId && !isAdmin) {
        throw new AppException('PERM_ROLE_FORBIDDEN', 403, 'review task is assigned to another reviewer');
      }

      await tx.query(
        `
          UPDATE review_task
          SET status = 'approved',
              reviewer_id = COALESCE(reviewer_id, $2),
              comment = COALESCE($3, comment),
              reviewed_at = NOW(),
              updated_at = NOW(),
              updated_by = $2
          WHERE id = $1
        `,
        [reviewTaskId, auth.userId, input.comment ?? null]
      );

      await tx.query(
        `
          UPDATE skill_version
          SET review_status = 'approved',
              published_at = COALESCE(published_at, NOW()),
              updated_at = NOW(),
              updated_by = $2
          WHERE id = $1
        `,
        [context.skill_version_id, auth.userId]
      );

      await tx.query(
        `
          UPDATE skill
          SET status = 'published',
              current_version_id = $2,
              updated_at = NOW(),
              updated_by = $3
          WHERE id = $1
        `,
        [context.skill_id, context.skill_version_id, auth.userId]
      );

      return {
        reviewTaskId,
        skillId: context.skill_id,
        skillVersionId: context.skill_version_id
      };
    });

    const job = await this.skillIndexQueueService.enqueueStage1Index(approval.skillVersionId, traceId);

    return {
      reviewTaskId: approval.reviewTaskId,
      skillId: approval.skillId,
      skillVersionId: approval.skillVersionId,
      skillStatus: 'published',
      reviewStatus: 'approved',
      stage1JobId: job.jobId
    };
  }

  private async assertCategoryExists(tx: PoolClient, categoryId?: number) {
    if (!categoryId) {
      return;
    }

    const result = await tx.query<{ id: number }>(`SELECT id FROM skill_category WHERE id = $1`, [categoryId]);
    if (result.rows.length === 0) {
      throw new AppException('SKILL_CATEGORY_NOT_FOUND', 404, 'skill category not found');
    }
  }

  private async assertTagsExist(tx: PoolClient, tagIds: number[]) {
    if (tagIds.length === 0) {
      return;
    }

    const result = await tx.query<{ id: number }>(
      `SELECT id FROM skill_tag WHERE id = ANY($1::bigint[])`,
      [tagIds]
    );
    if (result.rows.length !== tagIds.length) {
      throw new AppException('SKILL_TAG_NOT_FOUND', 404, 'one or more skill tags do not exist');
    }
  }

  private async insertTags(tx: PoolClient, skillId: number, tagIds: number[], actorUserId: number) {
    if (tagIds.length === 0) {
      return;
    }

    await tx.query(
      `
        INSERT INTO skill_tag_rel (skill_id, tag_id, created_by)
        SELECT $1, UNNEST($2::bigint[]), $3
      `,
      [skillId, tagIds, actorUserId]
    );
  }

  private async loadSkillForUpdate(tx: PoolClient, skillId: number): Promise<SkillRow> {
    const result = await tx.query<SkillRow>(
      `
        SELECT id, skill_key, owner_user_id, owner_department_id, status
        FROM skill
        WHERE id = $1
        FOR UPDATE
      `,
      [skillId]
    );

    const skill = result.rows[0];
    if (!skill) {
      throw new AppException('SKILL_NOT_FOUND', 404, 'skill not found');
    }

    return skill;
  }

  private async loadSkillVersionForUpdate(
    tx: PoolClient,
    skillVersionId: number,
    skillId: number
  ): Promise<SkillVersionRow> {
    const result = await tx.query<SkillVersionRow>(
      `
        SELECT id, skill_id, review_status
        FROM skill_version
        WHERE id = $1
          AND skill_id = $2
        FOR UPDATE
      `,
      [skillVersionId, skillId]
    );

    const version = result.rows[0];
    if (!version) {
      throw new AppException('SKILL_VERSION_NOT_FOUND', 404, 'skill version not found');
    }

    return version;
  }

  private async loadReviewTaskContextForUpdate(
    tx: PoolClient,
    reviewTaskId: number
  ): Promise<ReviewTaskContextRow> {
    const result = await tx.query<ReviewTaskContextRow>(
      `
        SELECT
          rt.id AS review_task_id,
          rt.status AS review_task_status,
          rt.reviewer_id,
          rt.submitter_id,
          sv.skill_id,
          s.status AS skill_status,
          sv.id AS skill_version_id,
          sv.review_status
        FROM review_task rt
        JOIN skill_version sv ON sv.id = rt.skill_version_id
        JOIN skill s ON s.id = sv.skill_id
        WHERE rt.id = $1
        FOR UPDATE OF rt, sv, s
      `,
      [reviewTaskId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new AppException('REVIEW_TASK_NOT_FOUND', 404, 'review task not found');
    }

    return row;
  }

  private async assertUserExists(
    tx: PoolClient,
    userId: number,
    code: string,
    message: string
  ) {
    const result = await tx.query<{ id: number }>(`SELECT id FROM "user" WHERE id = $1`, [userId]);
    if (result.rows.length === 0) {
      throw new AppException(code, 404, message);
    }
  }

  private assertSkillManageAllowed(skill: SkillRow, auth: AuthContext) {
    if (skill.owner_user_id === auth.userId) {
      return;
    }

    if (this.hasSkillAdminRole(auth)) {
      return;
    }

    const hasDeptManageRole = auth.roleCodes.some((role) => SKILL_DEPARTMENT_MANAGER_ROLES.has(role));
    if (hasDeptManageRole && skill.owner_department_id && auth.departmentIds.includes(skill.owner_department_id)) {
      return;
    }

    throw new AppException('PERM_SKILL_MANAGE_FORBIDDEN', 403, 'skill manage permission denied');
  }

  private hasSkillAdminRole(auth: AuthContext) {
    return auth.roleCodes.some((role) => SKILL_ADMIN_ROLES.has(role));
  }

  private resolveVersionPackageInput(skillKey: string, input: CreateSkillVersionRequestDto) {
    const hasInlineArtifact = Boolean(input.artifact);
    const hasExternalPackage = Boolean(input.packageUri || input.checksum);

    if (hasInlineArtifact && hasExternalPackage) {
      throw new AppException(
        'SKILL_VERSION_PACKAGE_CONFLICT',
        409,
        'artifact and packageUri/checksum cannot be submitted together'
      );
    }

    if (!hasInlineArtifact && (!input.packageUri || !input.checksum)) {
      throw new AppException(
        'SKILL_VERSION_PACKAGE_REQUIRED',
        422,
        'either artifact or packageUri/checksum is required'
      );
    }

    if (!hasInlineArtifact) {
      return {
        packageUri: input.packageUri!,
        checksum: input.checksum!,
        packageSource: 'external' as const
      };
    }

    try {
      const built = buildArtifactPackage(input.artifact?.format ?? 'zip', input.artifact?.entries ?? []);
      const artifactKey = this.skillArtifactService.generateArtifactKey();
      const fileName = this.skillArtifactService.buildArtifactFileName(skillKey, input.version, built.packageFormat);

      return {
        packageUri: this.skillArtifactService.buildPackageUri(artifactKey, fileName),
        checksum: built.checksum,
        packageSource: 'internal' as const,
        internalArtifact: {
          artifactKey,
          fileName,
          built
        }
      };
    } catch (error) {
      throw new AppException(
        'SKILL_ARTIFACT_INVALID',
        422,
        error instanceof Error ? error.message : 'invalid inline artifact payload'
      );
    }
  }

  private rethrowKnownDatabaseErrors(error: unknown, mapping: Record<string, AppException>) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint && mapping[pgError.constraint]) {
      throw mapping[pgError.constraint];
    }
  }
}
