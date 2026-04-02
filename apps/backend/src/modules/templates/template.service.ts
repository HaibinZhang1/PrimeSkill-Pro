import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import type { PublishTemplateRequestDto } from './template.types';

@Injectable()
export class TemplateService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async publishTemplate(input: PublishTemplateRequestDto, actorUserId: number): Promise<{ templateId: number }> {
    this.validateTemplateVariables(input);

    return this.db.withTransaction(async (tx) => {
      const existing = await tx.query<{ id: number }>(
        `
          SELECT id
          FROM ai_tool_install_target_template
          WHERE tool_id = $1
            AND template_code = $2
            AND template_revision = $3
            AND os_type = $4
          LIMIT 1
        `,
        [input.toolId, input.templateCode, input.templateRevision, input.osType]
      );
      if (existing.rows.length > 0) {
        throw new AppException('TEMPLATE_REVISION_EXISTS', 409, 'template revision already exists');
      }

      if (input.isDefault && input.releaseStatus === 'active') {
        await tx.query(
          `
            UPDATE ai_tool_install_target_template
            SET is_default = FALSE,
                updated_at = NOW(),
                updated_by = $5
            WHERE tool_id = $1
              AND os_type = $2
              AND scope_type = $3
              AND artifact_type = $4
              AND release_status = 'active'
              AND is_default = TRUE
          `,
          [input.toolId, input.osType, input.scopeType, input.artifactType, actorUserId]
        );
      }

      const inserted = await tx.query<{ id: number }>(
        `
          INSERT INTO ai_tool_install_target_template (
            tool_id,
            template_code,
            template_revision,
            os_type,
            artifact_type,
            scope_type,
            template_name,
            target_path_template,
            filename_template,
            packaging_mode,
            content_management_mode,
            managed_block_marker,
            path_variables_json,
            min_tool_version,
            max_tool_version,
            priority,
            is_default,
            release_status,
            verification_status,
            source_reference_url,
            created_by,
            updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20, $21, $21
          )
          RETURNING id
        `,
        [
          input.toolId,
          input.templateCode,
          input.templateRevision,
          input.osType,
          input.artifactType,
          input.scopeType,
          input.templateName,
          input.targetPathTemplate,
          input.filenameTemplate ?? null,
          input.packagingMode,
          input.contentManagementMode,
          input.managedBlockMarker ?? null,
          JSON.stringify(input.pathVariables),
          input.minToolVersion ?? null,
          input.maxToolVersion ?? null,
          input.priority ?? 100,
          input.isDefault ?? false,
          input.releaseStatus ?? 'active',
          input.verificationStatus ?? 'candidate',
          input.sourceReferenceUrl ?? null,
          actorUserId
        ]
      );

      return { templateId: inserted.rows[0].id };
    });
  }

  private validateTemplateVariables(input: PublishTemplateRequestDto) {
    const declared = new Set(input.pathVariables);
    const used = new Set<string>([
      ...this.extractVariables(input.targetPathTemplate),
      ...this.extractVariables(input.filenameTemplate ?? '')
    ]);

    if (used.size === 0) {
      throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, 'template must include at least one variable');
    }

    for (const key of used) {
      if (!declared.has(key)) {
        throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, `undeclared template variable: ${key}`);
      }
    }
  }

  private extractVariables(template: string): string[] {
    const matches = new Set<string>();
    template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_part, key: string) => {
      matches.add(key);
      return '';
    });
    return [...matches];
  }
}
