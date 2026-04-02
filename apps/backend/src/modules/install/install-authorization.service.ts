import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { AppException } from '../../common/app.exception';
import type { AuthContext } from '../../common/http.types';

type Queryable = {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

@Injectable()
export class InstallAuthorizationService {
  async assertSkillUseAllowed(
    queryable: Queryable,
    skillId: number,
    skillVersionId: number,
    auth: AuthContext
  ): Promise<void> {
    const result = await queryable.query<{ skill_id: number }>(
      `
        SELECT s.id AS skill_id
        FROM skill s
        JOIN skill_version sv ON sv.id = $2 AND sv.skill_id = s.id
        WHERE s.id = $1
          AND s.status = 'published'
          AND sv.review_status = 'approved'
          AND NOT EXISTS (
            SELECT 1
            FROM skill_permission_rule view_deny_rule
            WHERE view_deny_rule.skill_id = s.id
              AND view_deny_rule.rule_type = 'view'
              AND view_deny_rule.effect = 'deny'
              AND (
                (view_deny_rule.subject_type = 'user' AND view_deny_rule.subject_ref_id = $3)
                OR (view_deny_rule.subject_type = 'department' AND view_deny_rule.subject_ref_id = ANY($4::bigint[]))
                OR (view_deny_rule.subject_type = 'role' AND view_deny_rule.subject_ref_id::text = ANY($5::text[]))
                OR (view_deny_rule.subject_type = 'all')
              )
          )
          AND (
            s.visibility_type = 'public'
            OR EXISTS (
              SELECT 1
              FROM skill_permission_rule view_allow_rule
              WHERE view_allow_rule.skill_id = s.id
                AND view_allow_rule.rule_type = 'view'
                AND view_allow_rule.effect = 'allow'
                AND (
                  (view_allow_rule.subject_type = 'user' AND view_allow_rule.subject_ref_id = $3)
                  OR (view_allow_rule.subject_type = 'department' AND view_allow_rule.subject_ref_id = ANY($4::bigint[]))
                  OR (view_allow_rule.subject_type = 'role' AND view_allow_rule.subject_ref_id::text = ANY($5::text[]))
                  OR (view_allow_rule.subject_type = 'all')
                )
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM skill_permission_rule use_deny_rule
            WHERE use_deny_rule.skill_id = s.id
              AND use_deny_rule.rule_type = 'use'
              AND use_deny_rule.effect = 'deny'
              AND (
                (use_deny_rule.subject_type = 'user' AND use_deny_rule.subject_ref_id = $3)
                OR (use_deny_rule.subject_type = 'department' AND use_deny_rule.subject_ref_id = ANY($4::bigint[]))
                OR (use_deny_rule.subject_type = 'role' AND use_deny_rule.subject_ref_id::text = ANY($5::text[]))
                OR (use_deny_rule.subject_type = 'all')
              )
          )
          AND (
            NOT EXISTS (
              SELECT 1
              FROM skill_permission_rule use_allow_gate
              WHERE use_allow_gate.skill_id = s.id
                AND use_allow_gate.rule_type = 'use'
                AND use_allow_gate.effect = 'allow'
            )
            OR EXISTS (
              SELECT 1
              FROM skill_permission_rule use_allow_rule
              WHERE use_allow_rule.skill_id = s.id
                AND use_allow_rule.rule_type = 'use'
                AND use_allow_rule.effect = 'allow'
                AND (
                  (use_allow_rule.subject_type = 'user' AND use_allow_rule.subject_ref_id = $3)
                  OR (use_allow_rule.subject_type = 'department' AND use_allow_rule.subject_ref_id = ANY($4::bigint[]))
                  OR (use_allow_rule.subject_type = 'role' AND use_allow_rule.subject_ref_id::text = ANY($5::text[]))
                  OR (use_allow_rule.subject_type = 'all')
                )
            )
          )
        LIMIT 1
      `,
      [skillId, skillVersionId, auth.userId, auth.departmentIds, auth.roleCodes]
    );

    if (result.rows.length === 0) {
      throw new AppException('PERM_NO_USE_PERMISSION', 403, 'skill use permission denied');
    }
  }
}
