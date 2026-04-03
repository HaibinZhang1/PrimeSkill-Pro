import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import type { AuthContext } from '../../common/http.types';
import type {
  MyInstallDto,
  MyToolInstanceDto,
  MyWorkspaceDto,
  RegisterClientDeviceRequestDto,
  RegisterClientDeviceResponse,
  ReportToolInstancesRequestDto,
  ReportToolInstancesResponse,
  ReportWorkspacesRequestDto,
  ReportWorkspacesResponse
} from './runtime.types';

type DeviceStatus = 'active' | 'revoked' | 'offline';

@Injectable()
export class RuntimeService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async registerClientDevice(
    input: RegisterClientDeviceRequestDto,
    auth: AuthContext | undefined
  ): Promise<RegisterClientDeviceResponse> {
    const actor = this.requireAuth(auth);

    return this.db.withTransaction(async (tx) => {
      const existingById = actor.clientDeviceId
        ? await tx.query<{ id: number; user_id: number }>(`SELECT id, user_id FROM client_device WHERE id = $1`, [
            actor.clientDeviceId
          ])
        : null;

      if (existingById?.rows[0] && existingById.rows[0].user_id !== actor.userId) {
        throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'client device is bound to another user');
      }

      const existingByFingerprint = await tx.query<{ id: number; user_id: number }>(
        `
          SELECT id, user_id
          FROM client_device
          WHERE device_fingerprint = $1
          LIMIT 1
        `,
        [input.deviceFingerprint]
      );

      if (existingByFingerprint.rows[0] && existingByFingerprint.rows[0].user_id !== actor.userId) {
        throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'device fingerprint is bound to another user');
      }

      const record = actor.clientDeviceId
        ? await tx.query<{
            id: number;
            device_fingerprint: string;
            status: DeviceStatus;
            last_seen_at: Date;
          }>(
            `
              INSERT INTO client_device (
                id,
                user_id,
                device_fingerprint,
                device_name,
                os_type,
                os_version,
                desktop_app_version,
                native_core_version,
                last_seen_at,
                status,
                created_by,
                updated_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'active', $2, $2)
              ON CONFLICT (id) DO UPDATE
              SET device_fingerprint = EXCLUDED.device_fingerprint,
                  device_name = EXCLUDED.device_name,
                  os_type = EXCLUDED.os_type,
                  os_version = EXCLUDED.os_version,
                  desktop_app_version = EXCLUDED.desktop_app_version,
                  native_core_version = EXCLUDED.native_core_version,
                  last_seen_at = NOW(),
                  status = 'active',
                  updated_at = NOW(),
                  updated_by = EXCLUDED.updated_by
              RETURNING id, device_fingerprint, status, last_seen_at
            `,
            [
              actor.clientDeviceId,
              actor.userId,
              input.deviceFingerprint,
              input.deviceName,
              input.osType,
              input.osVersion ?? null,
              input.desktopAppVersion ?? null,
              input.nativeCoreVersion ?? null
            ]
          )
        : await tx.query<{
            id: number;
            device_fingerprint: string;
            status: DeviceStatus;
            last_seen_at: Date;
          }>(
            `
              INSERT INTO client_device (
                user_id,
                device_fingerprint,
                device_name,
                os_type,
                os_version,
                desktop_app_version,
                native_core_version,
                last_seen_at,
                status,
                created_by,
                updated_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'active', $1, $1)
              ON CONFLICT (device_fingerprint) DO UPDATE
              SET device_name = EXCLUDED.device_name,
                  os_type = EXCLUDED.os_type,
                  os_version = EXCLUDED.os_version,
                  desktop_app_version = EXCLUDED.desktop_app_version,
                  native_core_version = EXCLUDED.native_core_version,
                  last_seen_at = NOW(),
                  status = 'active',
                  updated_at = NOW(),
                  updated_by = EXCLUDED.updated_by
              RETURNING id, device_fingerprint, status, last_seen_at
            `,
            [
              actor.userId,
              input.deviceFingerprint,
              input.deviceName,
              input.osType,
              input.osVersion ?? null,
              input.desktopAppVersion ?? null,
              input.nativeCoreVersion ?? null
            ]
          );

      return {
        clientDeviceId: record.rows[0].id,
        deviceFingerprint: record.rows[0].device_fingerprint,
        status: record.rows[0].status,
        lastSeenAt: record.rows[0].last_seen_at.toISOString()
      };
    });
  }

  async reportToolInstances(
    input: ReportToolInstancesRequestDto,
    auth: AuthContext | undefined
  ): Promise<ReportToolInstancesResponse> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    return this.db.withTransaction(async (tx) => {
      await this.assertCurrentDevice(tx, actor.userId, clientDeviceId);

      const items: MyToolInstanceDto[] = [];
      for (const item of input.items) {
        const tool = await tx.query<{ id: number; tool_name: string; tool_code: string }>(
          `
            SELECT id, tool_name, tool_code
            FROM ai_tool_catalog
            WHERE tool_code = $1
              AND status = 'active'
            LIMIT 1
          `,
          [item.toolCode]
        );

        if (tool.rows.length === 0) {
          throw new AppException('TOOL_NOT_SUPPORTED', 422, `toolCode ${item.toolCode} is not supported`);
        }

        const existing = await tx.query<{ id: number }>(
          `
            SELECT id
            FROM tool_instance
            WHERE user_id = $1
              AND client_device_id = $2
              AND tool_id = $3
              AND COALESCE(detected_install_path, '') = COALESCE($4, '')
              AND COALESCE(detected_config_path, '') = COALESCE($5, '')
            LIMIT 1
          `,
          [
            actor.userId,
            clientDeviceId,
            tool.rows[0].id,
            item.detectedInstallPath ?? null,
            item.detectedConfigPath ?? null
          ]
        );

        const saved = existing.rows[0]
          ? await tx.query<{
              id: number;
              client_device_id: number;
              os_type: string;
              detected_install_path: string | null;
              detected_config_path: string | null;
              discovered_targets_json: string[];
              detection_source: 'auto' | 'manual' | 'imported';
              trust_status: 'detected' | 'verified' | 'disabled';
              last_scanned_at: Date;
            }>(
              `
                UPDATE tool_instance
                SET tool_version = $2,
                    os_type = $3,
                    detected_install_path = $4,
                    detected_config_path = $5,
                    discovered_targets_json = $6::jsonb,
                    detection_source = $7,
                    trust_status = $8,
                    last_scanned_at = NOW(),
                    updated_at = NOW(),
                    updated_by = $9
                WHERE id = $1
                RETURNING
                  id,
                  client_device_id,
                  os_type,
                  detected_install_path,
                  detected_config_path,
                  discovered_targets_json,
                  detection_source,
                  trust_status,
                  last_scanned_at
              `,
              [
                existing.rows[0].id,
                item.toolVersion ?? null,
                item.osType,
                item.detectedInstallPath ?? null,
                item.detectedConfigPath ?? null,
                JSON.stringify(item.discoveredTargets ?? []),
                item.detectionSource ?? 'auto',
                item.trustStatus ?? 'verified',
                actor.userId
              ]
            )
          : await tx.query<{
              id: number;
              client_device_id: number;
              os_type: string;
              detected_install_path: string | null;
              detected_config_path: string | null;
              discovered_targets_json: string[];
              detection_source: 'auto' | 'manual' | 'imported';
              trust_status: 'detected' | 'verified' | 'disabled';
              last_scanned_at: Date;
            }>(
              `
                INSERT INTO tool_instance (
                  user_id,
                  client_device_id,
                  tool_id,
                  tool_version,
                  os_type,
                  detected_install_path,
                  detected_config_path,
                  discovered_targets_json,
                  detection_source,
                  trust_status,
                  last_scanned_at,
                  created_by,
                  updated_by
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW(), $1, $1
                )
                RETURNING
                  id,
                  client_device_id,
                  os_type,
                  detected_install_path,
                  detected_config_path,
                  discovered_targets_json,
                  detection_source,
                  trust_status,
                  last_scanned_at
              `,
              [
                actor.userId,
                clientDeviceId,
                tool.rows[0].id,
                item.toolVersion ?? null,
                item.osType,
                item.detectedInstallPath ?? null,
                item.detectedConfigPath ?? null,
                JSON.stringify(item.discoveredTargets ?? []),
                item.detectionSource ?? 'auto',
                item.trustStatus ?? 'verified'
              ]
            );

        items.push({
          toolInstanceId: saved.rows[0].id,
          clientDeviceId: saved.rows[0].client_device_id,
          toolCode: tool.rows[0].tool_code,
          toolName: tool.rows[0].tool_name,
          toolVersion: item.toolVersion,
          osType: saved.rows[0].os_type,
          detectedInstallPath: saved.rows[0].detected_install_path ?? undefined,
          detectedConfigPath: saved.rows[0].detected_config_path ?? undefined,
          discoveredTargets: saved.rows[0].discovered_targets_json ?? [],
          detectionSource: saved.rows[0].detection_source,
          trustStatus: saved.rows[0].trust_status,
          lastScannedAt: saved.rows[0].last_scanned_at.toISOString()
        });
      }

      await this.touchDevice(tx, clientDeviceId, actor.userId);
      return { items };
    });
  }

  async reportWorkspaces(
    input: ReportWorkspacesRequestDto,
    auth: AuthContext | undefined
  ): Promise<ReportWorkspacesResponse> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    return this.db.withTransaction(async (tx) => {
      await this.assertCurrentDevice(tx, actor.userId, clientDeviceId);

      const items: MyWorkspaceDto[] = [];
      for (const item of input.items) {
        const saved = await tx.query<{
          id: number;
          client_device_id: number;
          workspace_name: string | null;
          workspace_path: string;
          project_fingerprint: string;
          repo_remote: string | null;
          repo_branch: string | null;
          last_used_at: Date | null;
          updated_at: Date;
        }>(
          `
            INSERT INTO workspace_registry (
              user_id,
              client_device_id,
              workspace_name,
              workspace_path,
              repo_remote,
              repo_branch,
              project_fingerprint,
              last_used_at,
              created_by,
              updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $1, $1)
            ON CONFLICT (client_device_id, project_fingerprint) DO UPDATE
            SET workspace_name = EXCLUDED.workspace_name,
                workspace_path = EXCLUDED.workspace_path,
                repo_remote = EXCLUDED.repo_remote,
                repo_branch = EXCLUDED.repo_branch,
                last_used_at = NOW(),
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            RETURNING
              id,
              client_device_id,
              workspace_name,
              workspace_path,
              project_fingerprint,
              repo_remote,
              repo_branch,
              last_used_at,
              updated_at
          `,
          [
            actor.userId,
            clientDeviceId,
            item.workspaceName ?? null,
            item.workspacePath,
            item.repoRemote ?? null,
            item.repoBranch ?? null,
            item.projectFingerprint
          ]
        );

        items.push({
          workspaceRegistryId: saved.rows[0].id,
          clientDeviceId: saved.rows[0].client_device_id,
          workspaceName: saved.rows[0].workspace_name ?? undefined,
          workspacePath: saved.rows[0].workspace_path,
          projectFingerprint: saved.rows[0].project_fingerprint,
          repoRemote: saved.rows[0].repo_remote ?? undefined,
          repoBranch: saved.rows[0].repo_branch ?? undefined,
          lastUsedAt: saved.rows[0].last_used_at?.toISOString(),
          updatedAt: saved.rows[0].updated_at.toISOString()
        });
      }

      await this.touchDevice(tx, clientDeviceId, actor.userId);
      return { items };
    });
  }

  async getMyToolInstances(auth: AuthContext | undefined): Promise<{ items: MyToolInstanceDto[] }> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    const result = await this.db.query<{
      id: number;
      client_device_id: number;
      tool_code: string;
      tool_name: string;
      tool_version: string | null;
      os_type: string;
      detected_install_path: string | null;
      detected_config_path: string | null;
      discovered_targets_json: string[];
      detection_source: 'auto' | 'manual' | 'imported';
      trust_status: 'detected' | 'verified' | 'disabled';
      last_scanned_at: Date | null;
    }>(
      `
        SELECT
          ti.id,
          ti.client_device_id,
          cat.tool_code,
          cat.tool_name,
          ti.tool_version,
          ti.os_type,
          ti.detected_install_path,
          ti.detected_config_path,
          ti.discovered_targets_json,
          ti.detection_source,
          ti.trust_status,
          ti.last_scanned_at
        FROM tool_instance ti
        JOIN ai_tool_catalog cat ON cat.id = ti.tool_id
        WHERE ti.user_id = $1
          AND ti.client_device_id = $2
        ORDER BY cat.tool_name ASC, ti.id ASC
      `,
      [actor.userId, clientDeviceId]
    );

    return {
      items: result.rows.map((row) => ({
        toolInstanceId: row.id,
        clientDeviceId: row.client_device_id,
        toolCode: row.tool_code,
        toolName: row.tool_name,
        toolVersion: row.tool_version ?? undefined,
        osType: row.os_type,
        detectedInstallPath: row.detected_install_path ?? undefined,
        detectedConfigPath: row.detected_config_path ?? undefined,
        discoveredTargets: row.discovered_targets_json ?? [],
        detectionSource: row.detection_source,
        trustStatus: row.trust_status,
        lastScannedAt: row.last_scanned_at?.toISOString()
      }))
    };
  }

  async getMyWorkspaces(auth: AuthContext | undefined): Promise<{ items: MyWorkspaceDto[] }> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    const result = await this.db.query<{
      id: number;
      client_device_id: number;
      workspace_name: string | null;
      workspace_path: string;
      project_fingerprint: string;
      repo_remote: string | null;
      repo_branch: string | null;
      last_used_at: Date | null;
      updated_at: Date;
    }>(
      `
        SELECT
          id,
          client_device_id,
          workspace_name,
          workspace_path,
          project_fingerprint,
          repo_remote,
          repo_branch,
          last_used_at,
          updated_at
        FROM workspace_registry
        WHERE user_id = $1
          AND client_device_id = $2
        ORDER BY COALESCE(last_used_at, updated_at) DESC, id DESC
      `,
      [actor.userId, clientDeviceId]
    );

    return {
      items: result.rows.map((row) => ({
        workspaceRegistryId: row.id,
        clientDeviceId: row.client_device_id,
        workspaceName: row.workspace_name ?? undefined,
        workspacePath: row.workspace_path,
        projectFingerprint: row.project_fingerprint,
        repoRemote: row.repo_remote ?? undefined,
        repoBranch: row.repo_branch ?? undefined,
        lastUsedAt: row.last_used_at?.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }))
    };
  }

  async getMyInstalls(auth: AuthContext | undefined): Promise<{ items: MyInstallDto[] }> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    const result = await this.db.query<{
      binding_id: number;
      install_record_id: number;
      skill_id: number;
      skill_version_id: number;
      skill_key: string;
      skill_name: string;
      skill_version: string;
      tool_instance_id: number | null;
      tool_code: string | null;
      tool_name: string | null;
      target_scope: 'global' | 'project';
      workspace_registry_id: number | null;
      workspace_name: string | null;
      workspace_path: string | null;
      resolved_target_path: string;
      install_status: string;
      installed_at: Date;
      state: 'active' | 'removed' | 'drifted';
    }>(
      `
        SELECT
          lib.id AS binding_id,
          lib.install_record_id,
          lib.skill_id,
          lib.skill_version_id,
          s.skill_key,
          s.name AS skill_name,
          sv.version AS skill_version,
          lib.tool_instance_id,
          cat.tool_code,
          cat.tool_name,
          lib.target_scope,
          lib.workspace_registry_id,
          wr.workspace_name,
          wr.workspace_path,
          lib.resolved_target_path,
          ir.install_status,
          lib.installed_at,
          lib.state
        FROM local_install_binding lib
        JOIN install_record ir ON ir.id = lib.install_record_id
        JOIN skill s ON s.id = lib.skill_id
        LEFT JOIN skill_version sv ON sv.id = lib.skill_version_id
        LEFT JOIN tool_instance ti ON ti.id = lib.tool_instance_id
        LEFT JOIN ai_tool_catalog cat ON cat.id = ti.tool_id
        LEFT JOIN workspace_registry wr ON wr.id = lib.workspace_registry_id
        WHERE ir.user_id = $1
          AND lib.client_device_id = $2
          AND lib.state = 'active'
        ORDER BY lib.installed_at DESC, lib.id DESC
      `,
      [actor.userId, clientDeviceId]
    );

    return {
      items: result.rows.map((row) => ({
        bindingId: row.binding_id,
        installRecordId: row.install_record_id,
        skillId: row.skill_id,
        skillVersionId: row.skill_version_id,
        skillKey: row.skill_key,
        skillName: row.skill_name,
        skillVersion: row.skill_version,
        toolInstanceId: row.tool_instance_id ?? undefined,
        toolCode: row.tool_code ?? undefined,
        toolName: row.tool_name ?? undefined,
        targetScope: row.target_scope,
        workspaceRegistryId: row.workspace_registry_id ?? undefined,
        workspaceName: row.workspace_name ?? undefined,
        workspacePath: row.workspace_path ?? undefined,
        resolvedTargetPath: row.resolved_target_path,
        installStatus: row.install_status,
        installedAt: row.installed_at.toISOString(),
        state: row.state
      }))
    };
  }

  private requireAuth(auth: AuthContext | undefined): AuthContext {
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }
    return auth;
  }

  private requireClientDevice(auth: AuthContext) {
    if (!auth.clientDeviceId) {
      throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'clientDeviceId missing in token');
    }
    return auth.clientDeviceId;
  }

  private async assertCurrentDevice(tx: PoolClient, userId: number, clientDeviceId: number) {
    const device = await tx.query<{ id: number }>(
      `
        SELECT id
        FROM client_device
        WHERE id = $1
          AND user_id = $2
          AND status <> 'revoked'
        LIMIT 1
      `,
      [clientDeviceId, userId]
    );

    if (device.rows.length === 0) {
      throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'client device is not registered');
    }
  }

  private async touchDevice(tx: PoolClient, clientDeviceId: number, userId: number) {
    await tx.query(
      `
        UPDATE client_device
        SET last_seen_at = NOW(),
            updated_at = NOW(),
            updated_by = $2
        WHERE id = $1
      `,
      [clientDeviceId, userId]
    );
  }
}
