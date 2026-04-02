export interface PermissionScope {
  userId: number;
  departmentIds: number[];
  roleCodes: string[];
}

/*
  Stage1 must run with SQL prefilter.
  This function returns WHERE fragment + bind params for:
  - visible skill
  - usable skill
  - deny-first precedence
*/
export function buildPermissionPrefilter(scope: PermissionScope): { whereSql: string; params: unknown[] } {
  const params: unknown[] = [scope.userId, scope.departmentIds, scope.roleCodes];
  const whereSql = `
    s.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM skill_permission_rule deny_rule
      WHERE deny_rule.skill_id = s.id
        AND deny_rule.effect = 'deny'
        AND (
          (deny_rule.subject_type = 'user' AND deny_rule.subject_ref_id = $1)
          OR (deny_rule.subject_type = 'department' AND deny_rule.subject_ref_id = ANY($2::bigint[]))
          OR (deny_rule.subject_type = 'role' AND deny_rule.subject_ref_id::text = ANY($3::text[]))
          OR (deny_rule.subject_type = 'all')
        )
    )
    AND (
      s.visibility_type = 'public'
      OR EXISTS (
        SELECT 1 FROM skill_permission_rule allow_rule
        WHERE allow_rule.skill_id = s.id
          AND allow_rule.effect = 'allow'
          AND (
            (allow_rule.subject_type = 'user' AND allow_rule.subject_ref_id = $1)
            OR (allow_rule.subject_type = 'department' AND allow_rule.subject_ref_id = ANY($2::bigint[]))
            OR (allow_rule.subject_type = 'role' AND allow_rule.subject_ref_id::text = ANY($3::text[]))
            OR (allow_rule.subject_type = 'all')
          )
      )
    )
  `;
  return { whereSql, params };
}
