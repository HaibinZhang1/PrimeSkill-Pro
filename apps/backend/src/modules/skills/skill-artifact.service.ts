import { randomUUID } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import {
  type BuiltArtifactPackage,
  buildInternalArtifactUrl,
  resolvePublicApiBaseUrl
} from './artifact-package.util';

interface SkillVersionArtifactRow {
  artifact_key: string;
  package_format: 'zip' | 'legacy_json';
  mime_type: string;
  file_name: string;
  sha256: string;
  byte_size: number;
  entry_count: number;
  package_bytes: Buffer;
}

@Injectable()
export class SkillArtifactService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  buildArtifactFileName(skillKey: string, version: string, packageFormat: 'zip' | 'legacy_json') {
    const safeSkillKey = skillKey.replace(/[^a-zA-Z0-9_-]+/g, '-');
    const safeVersion = version.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const extension = packageFormat === 'zip' ? 'zip' : 'json';
    return `${safeSkillKey}-${safeVersion}.${extension}`;
  }

  buildPackageUri(artifactKey: string, fileName: string) {
    return buildInternalArtifactUrl(resolvePublicApiBaseUrl(), artifactKey, fileName);
  }

  generateArtifactKey() {
    return `sva_${randomUUID().replace(/-/g, '')}`;
  }

  async createArtifact(
    tx: PoolClient,
    input: {
      skillVersionId: number;
      artifactKey: string;
      fileName: string;
      built: BuiltArtifactPackage;
      actorUserId: number;
    }
  ) {
    await tx.query(
      `
        INSERT INTO skill_version_artifact (
          skill_version_id,
          artifact_key,
          storage_kind,
          package_format,
          mime_type,
          file_name,
          sha256,
          byte_size,
          entry_count,
          package_bytes,
          created_by,
          updated_by
        )
        VALUES (
          $1, $2, 'database_inline', $3, $4, $5, $6, $7, $8, $9, $10, $10
        )
      `,
      [
        input.skillVersionId,
        input.artifactKey,
        input.built.packageFormat,
        input.built.mimeType,
        input.fileName,
        input.built.checksum,
        input.built.bytes.length,
        input.built.entryCount,
        input.built.bytes,
        input.actorUserId
      ]
    );
  }

  async loadArtifactForDownload(artifactKey: string) {
    const result = await this.db.query<SkillVersionArtifactRow>(
      `
        SELECT
          artifact_key,
          package_format,
          mime_type,
          file_name,
          sha256,
          byte_size,
          entry_count,
          package_bytes
        FROM skill_version_artifact
        WHERE artifact_key = $1
        LIMIT 1
      `,
      [artifactKey]
    );

    const artifact = result.rows[0];
    if (!artifact) {
      throw new AppException('ARTIFACT_NOT_FOUND', 404, 'artifact not found');
    }

    return artifact;
  }
}
