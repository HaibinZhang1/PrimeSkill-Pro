import { randomUUID } from 'crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppException } from '../../common/app.exception';
import { DatabaseService } from '../../common/database.service';
import type { AuthContext } from '../../common/http.types';
import { InstallLockService } from '../../common/install-lock.service';
import { InstallAuthorizationService } from './install-authorization.service';
import {
  type ConsumeInstallTicketRequestDto,
  type CreateInstallTicketRequestDto,
  type InstallManifestResponseDto,
  type InstallTicketPayload,
  INSTALL_STAGE_ORDER,
  type ReportInstallOperationRequestDto
} from './install.types';

const FINAL_STATUSES = new Set(['success', 'failed', 'rolled_back', 'cancelled']);

type InstallStatus =
  | 'pending'
  | 'ticket_issued'
  | 'downloading'
  | 'staging'
  | 'verifying'
  | 'committing'
  | 'success'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'cancelled';

interface PreparedInstallTarget {
  toolInstanceId: number;
  clientDeviceId: number;
  osType: string;
  trustStatus: string;
  skillId: number;
  skillVersionId: number;
  skillKey: string;
  packageUri: string;
  checksum: string;
  signature: string | null;
  templateId: number;
  templateCode: string;
  templateRevision: number;
  targetPathTemplate: string;
  filenameTemplate: string | null;
  packagingMode: string;
  contentManagementMode: string;
  managedBlockMarker: string | null;
  pathVariables: string[];
  workspacePath: string | null;
  workspaceRegistryId: number | null;
}

interface TicketWithRecord {
  ticketId: string;
  installRecordId: number;
  userId: number;
  clientDeviceId: number;
  operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback';
  skillId: number;
  skillVersionId: number;
  status: 'issued' | 'consumed' | 'expired' | 'cancelled';
  consumeMode: 'one_time' | 'idempotent_retry';
  retryToken: string | null;
  expiresAt: Date;
  manifestSnapshot: InstallManifestResponseDto;
  installStatus: InstallStatus;
  statusVersion: number;
  resolvedTargetPath: string;
  lockKey: string;
  deviceFingerprint: string;
}

@Injectable()
export class InstallService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(InstallLockService) private readonly lockService: InstallLockService,
    @Inject(InstallAuthorizationService) private readonly authorizationService: InstallAuthorizationService
  ) {}

  async createTicket(
    input: CreateInstallTicketRequestDto,
    auth: AuthContext | undefined,
    traceId: string
  ): Promise<InstallTicketPayload> {
    const actor = this.requireAuth(auth);
    const clientDeviceId = this.requireClientDevice(actor);

    // Mock fallback for empty database demo mode
    if (input.toolInstanceId < 0) {
      return {
        ticketId: `tk_demo_${randomUUID().replace(/-/g, '')}`,
        installRecordId: Math.floor(Math.random() * 10000) + 1,
        consumeMode: 'one_time',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      };
    }

    return this.db.withTransaction(async (tx) => {
      const prepared = await this.prepareInstallTarget(tx, input, actor.userId);
      if (prepared.clientDeviceId !== clientDeviceId) {
        throw new AppException('PERM_NO_USE_PERMISSION', 403, 'tool instance does not belong to current device');
      }
      if (this.requiresActiveUsePermission(input.operationType)) {
        await this.authorizationService.assertSkillUseAllowed(tx, input.skillId, input.skillVersionId, actor);
      }

      const existingRecord = await tx.query<{ id: number }>(
        `
          SELECT id
          FROM install_record
          WHERE source_client_id = $1
            AND operation_type = $2
            AND idempotency_key = $3
            AND created_at > NOW() - INTERVAL '24 hours'
          ORDER BY id DESC
          LIMIT 1
        `,
        [clientDeviceId, input.operationType, input.idempotencyKey]
      );

      if (existingRecord.rows.length > 0) {
        const recordId = existingRecord.rows[0].id;
        const existingTicket = await tx.query<{
          ticket_id: string;
          consume_mode: 'one_time' | 'idempotent_retry';
          retry_token: string | null;
          expires_at: Date;
        }>(
          `
            SELECT ticket_id, consume_mode, retry_token, expires_at
            FROM install_ticket
            WHERE install_record_id = $1
            ORDER BY id DESC
            LIMIT 1
          `,
          [recordId]
        );

        if (existingTicket.rows.length > 0) {
          return {
            ticketId: existingTicket.rows[0].ticket_id,
            installRecordId: recordId,
            consumeMode: existingTicket.rows[0].consume_mode,
            retryToken: existingTicket.rows[0].retry_token ?? undefined,
            expiresAt: existingTicket.rows[0].expires_at.toISOString()
          };
        }
      }

      const variables = this.buildTemplateVariables(prepared.workspacePath, prepared.skillKey);
      this.validateTemplateVariables(prepared, variables);
      const resolvedTargetPath = this.buildResolvedTargetPath(
        prepared.targetPathTemplate,
        prepared.filenameTemplate,
        variables
      );
      const lockKey = this.lockService.buildLockKey({
        clientDeviceId,
        resolvedTargetPath
      });

      if (input.operationType === 'uninstall' || input.operationType === 'rollback') {
        const activeBinding = await tx.query<{ id: number }>(
          `
            SELECT id
            FROM local_install_binding
            WHERE client_device_id = $1
              AND tool_instance_id = $2
              AND skill_id = $3
              AND skill_version_id = $4
              AND target_scope = $5
              AND COALESCE(workspace_registry_id, 0) = COALESCE($6, 0)
              AND resolved_target_path = $7
              AND state IN ('active', 'drifted')
            LIMIT 1
          `,
          [
            clientDeviceId,
            input.toolInstanceId,
            input.skillId,
            input.skillVersionId,
            input.targetScope,
            prepared.workspaceRegistryId,
            resolvedTargetPath
          ]
        );

        if (activeBinding.rows.length === 0) {
          throw new AppException(
            'INSTALL_RECORD_STATUS_CONFLICT',
            409,
            `active install binding not found for ${input.operationType}`
          );
        }
      }

      const installRecordInsert = await tx.query<{ id: number }>(
        `
          INSERT INTO install_record (
            operation_type,
            user_id,
            skill_id,
            skill_version_id,
            target_scope,
            tool_instance_id,
            install_target_template_id,
            workspace_registry_id,
            resolved_target_path,
            lock_key,
            idempotency_key,
            install_status,
            source_client_id,
            trace_id,
            started_at,
            created_by,
            updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            'ticket_issued', $12, $13, NOW(), $2, $2
          )
          RETURNING id
        `,
        [
          input.operationType,
          actor.userId,
          input.skillId,
          input.skillVersionId,
          input.targetScope,
          input.toolInstanceId,
          prepared.templateId,
          prepared.workspaceRegistryId,
          resolvedTargetPath,
          lockKey,
          input.idempotencyKey,
          clientDeviceId,
          traceId
        ]
      );
      const installRecordId = installRecordInsert.rows[0].id;

      const ticketId = `tk_${randomUUID().replace(/-/g, '')}`;
      const consumeMode: 'one_time' | 'idempotent_retry' =
        input.operationType === 'install' ? 'one_time' : 'idempotent_retry';
      const retryToken = consumeMode === 'idempotent_retry' ? `rt_${randomUUID().replace(/-/g, '')}` : null;
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      const manifest = this.buildManifestSnapshot(ticketId, installRecordId, prepared, variables, retryToken);

      await tx.query(
        `
          UPDATE install_record
          SET manifest_snapshot_json = $2::jsonb,
              updated_at = NOW(),
              updated_by = $3
          WHERE id = $1
        `,
        [installRecordId, JSON.stringify(manifest), actor.userId]
      );

      await tx.query(
        `
          INSERT INTO install_ticket (
            ticket_id,
            install_record_id,
            user_id,
            client_device_id,
            tool_instance_id,
            workspace_registry_id,
            install_target_template_id,
            ticket_scope,
            status,
            consume_mode,
            retry_token,
            manifest_snapshot_json,
            expires_at,
            idempotency_key,
            trace_id,
            created_by,
            updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            'issued', $9, $10, $11::jsonb, $12, $13, $14, $3, $3
          )
        `,
        [
          ticketId,
          installRecordId,
          actor.userId,
          clientDeviceId,
          input.toolInstanceId,
          prepared.workspaceRegistryId,
          prepared.templateId,
          input.operationType,
          consumeMode,
          retryToken,
          JSON.stringify(manifest),
          expiresAt,
          input.idempotencyKey,
          traceId
        ]
      );

      return {
        ticketId,
        installRecordId,
        consumeMode,
        retryToken: retryToken ?? undefined,
        expiresAt: expiresAt.toISOString()
      };
    });
  }

  async getManifest(
    ticketId: string,
    auth: AuthContext | undefined,
    deviceToken: string
  ): Promise<InstallManifestResponseDto> {
    const actor = this.requireAuth(auth);
    const ticket = await this.loadTicketContext(ticketId, actor, deviceToken, false);
    if (this.requiresActiveUsePermission(ticket.operationType)) {
      await this.authorizationService.assertSkillUseAllowed(this.db, ticket.skillId, ticket.skillVersionId, actor);
    }

    if (this.isExpired(ticket)) {
      await this.db.query(
        `UPDATE install_ticket SET status='expired', updated_at=NOW(), updated_by=$2 WHERE ticket_id = $1 AND status = 'issued'`,
        [ticketId, actor.userId]
      );
      throw new AppException('TICKET_EXPIRED', 410, 'ticket expired');
    }

    if (ticket.consumeMode === 'one_time' && ticket.status === 'consumed') {
      throw new AppException('TICKET_ALREADY_CONSUMED', 409, 'ticket already consumed');
    }

    return ticket.manifestSnapshot;
  }

  async consume(
    ticketId: string,
    payload: ConsumeInstallTicketRequestDto,
    auth: AuthContext | undefined,
    deviceToken: string
  ): Promise<{ nextAction: 'continue' | 'abort' }> {
    const actor = this.requireAuth(auth);

    return this.db.withTransaction(async (tx) => {
      const ticket = await this.loadTicketContext(ticketId, actor, deviceToken, true, tx);
      if (ticket.installRecordId !== payload.installRecordId) {
        throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'ticket and installRecordId mismatch');
      }
      if (this.requiresActiveUsePermission(ticket.operationType)) {
        await this.authorizationService.assertSkillUseAllowed(tx, ticket.skillId, ticket.skillVersionId, actor);
      }

      if (this.isExpired(ticket)) {
        await tx.query(
          `UPDATE install_ticket SET status='expired', updated_at=NOW(), updated_by=$2 WHERE ticket_id = $1 AND status = 'issued'`,
          [ticketId, actor.userId]
        );
        throw new AppException('TICKET_EXPIRED', 410, 'ticket expired');
      }

      if (ticket.consumeMode === 'one_time' && ticket.status === 'consumed') {
        throw new AppException('TICKET_ALREADY_CONSUMED', 409, 'ticket already consumed');
      }
      this.assertRetryToken(ticket, payload.retryToken);

      if (FINAL_STATUSES.has(ticket.installStatus)) {
        if (ticket.consumeMode === 'idempotent_retry' && payload.result === 'failed' && ticket.installStatus === 'failed') {
          return { nextAction: 'abort' };
        }
        throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'install record already finalized');
      }

      const expectedStage = this.expectedStageFromStatus(ticket.installStatus);
      if (expectedStage !== payload.stage) {
        if (this.isIdempotentRetryOfSuccessfulStage(ticket, payload.stage, payload.result)) {
          return { nextAction: 'continue' };
        }
        throw new AppException(
          'INSTALL_STAGE_OUT_OF_ORDER',
          412,
          `expected stage ${expectedStage}, got ${payload.stage}`
        );
      }

      if (payload.result === 'failed') {
        await tx.query(
          `
            UPDATE install_record
            SET install_status = 'failed',
                status_version = status_version + 1,
                error_code = 'INSTALL_STAGE_FAILED',
                error_message = $2,
                trace_id = $3,
                updated_at = NOW(),
                updated_by = $4
            WHERE id = $1
          `,
          [ticket.installRecordId, `stage ${payload.stage} failed`, payload.traceId, actor.userId]
        );
        await tx.query(
          `
            UPDATE install_ticket
            SET status = 'consumed',
                consumed_at = NOW(),
                updated_at = NOW(),
                updated_by = $2
            WHERE ticket_id = $1
          `,
          [ticket.ticketId, actor.userId]
        );
        return { nextAction: 'abort' };
      }

      const nextStatus = this.nextStatusForStage(payload.stage);
      const updateStatus = async () => {
        await tx.query(
          `
            UPDATE install_record
            SET install_status = $2,
                status_version = status_version + 1,
                trace_id = $3,
                updated_at = NOW(),
                updated_by = $4
            WHERE id = $1
          `,
          [ticket.installRecordId, nextStatus, payload.traceId, actor.userId]
        );

        if (payload.stage === 'committing') {
          await tx.query(
            `
              UPDATE install_ticket
              SET status = 'consumed',
                  consumed_at = NOW(),
                  updated_at = NOW(),
                  updated_by = $2
              WHERE ticket_id = $1
            `,
            [ticket.ticketId, actor.userId]
          );
        }
      };

      if (payload.stage === 'committing') {
        await this.lockService.withDualLock(
          {
            clientDeviceId: ticket.clientDeviceId,
            resolvedTargetPath: ticket.resolvedTargetPath
          },
          tx,
          updateStatus
        );
      } else {
        await updateStatus();
      }

      return { nextAction: 'continue' };
    });
  }

  async reportFinal(
    installRecordId: number,
    payload: ReportInstallOperationRequestDto,
    auth: AuthContext | undefined,
    deviceToken: string
  ): Promise<{ ok: true }> {
    const actor = this.requireAuth(auth);

    await this.db.withTransaction(async (tx) => {
      const recordResult = await tx.query<{
        id: number;
        user_id: number;
        source_client_id: number;
        operation_type: 'install' | 'upgrade' | 'uninstall' | 'rollback';
        resolved_target_path: string;
        install_status: InstallStatus;
        skill_id: number;
        skill_version_id: number;
        target_scope: 'global' | 'project';
        workspace_registry_id: number | null;
        install_target_template_id: number | null;
        tool_instance_id: number | null;
        device_fingerprint: string;
      }>(
        `
          SELECT
            ir.id,
            ir.user_id,
            ir.source_client_id,
            ir.operation_type,
            ir.resolved_target_path,
            ir.install_status,
            ir.skill_id,
            ir.skill_version_id,
            ir.target_scope,
            ir.workspace_registry_id,
            ir.install_target_template_id,
            ir.tool_instance_id,
            cd.device_fingerprint
          FROM install_record ir
          JOIN client_device cd ON cd.id = ir.source_client_id
          WHERE ir.id = $1
          FOR UPDATE
        `,
        [installRecordId]
      );

      const record = recordResult.rows[0];
      if (!record || record.user_id !== actor.userId) {
        throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'install record not found');
      }
      if (record.device_fingerprint !== deviceToken) {
        throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'device token mismatch');
      }
      if (FINAL_STATUSES.has(record.install_status)) {
        throw new AppException('INSTALL_RECORD_ALREADY_FINALIZED', 409, 'install record already finalized');
      }

      const resolvedTargetPath = payload.resolvedTargetPath ?? record.resolved_target_path;
      if (!resolvedTargetPath) {
        throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'resolved target path missing');
      }
      this.assertFinalStatusMatchesOperation(record.operation_type, payload.finalStatus);
      if (this.requiresActiveUsePermission(record.operation_type) && payload.finalStatus === 'success') {
        await this.authorizationService.assertSkillUseAllowed(tx, record.skill_id, record.skill_version_id, actor);
      }

      await this.lockService.withDualLock(
        {
          clientDeviceId: record.source_client_id,
          resolvedTargetPath
        },
        tx,
        async () => {
          if (
            (payload.finalStatus === 'success' && record.operation_type === 'uninstall') ||
            (payload.finalStatus === 'rolled_back' && record.operation_type === 'rollback')
          ) {
            const removed = await tx.query<{ id: number }>(
              `
                UPDATE local_install_binding
                SET state = 'removed',
                    removed_at = NOW(),
                    updated_at = NOW(),
                    updated_by = $3
                WHERE client_device_id = $1
                  AND resolved_target_path = $2
                  AND state IN ('active', 'drifted')
                RETURNING id
              `,
              [record.source_client_id, resolvedTargetPath, actor.userId]
            );

            if (removed.rows.length === 0) {
              throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'active install binding not found');
            }
          } else if (payload.finalStatus === 'success') {
            await tx.query(
              `
                UPDATE local_install_binding
                SET state = 'removed',
                    removed_at = NOW(),
                    updated_at = NOW(),
                    updated_by = $3
                WHERE client_device_id = $1
                  AND resolved_target_path = $2
                  AND state IN ('active', 'drifted')
              `,
              [record.source_client_id, resolvedTargetPath, actor.userId]
            );
            await tx.query(
              `
                INSERT INTO local_install_binding (
                  client_device_id,
                  tool_instance_id,
                  skill_id,
                  skill_version_id,
                  install_record_id,
                  target_scope,
                  workspace_registry_id,
                  install_target_template_id,
                  resolved_target_path,
                  state,
                  trace_id,
                  created_by,
                  updated_by
                )
                VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9,
                  'active', $10, $11, $11
                )
              `,
              [
                record.source_client_id,
                record.tool_instance_id,
                record.skill_id,
                record.skill_version_id,
                installRecordId,
                record.target_scope,
                record.workspace_registry_id,
                record.install_target_template_id,
                resolvedTargetPath,
                payload.traceId,
                actor.userId
              ]
            );
          }

          await tx.query(
            `
              UPDATE install_record
              SET install_status = $2::varchar,
                  status_version = status_version + 1,
                  finished_at = NOW(),
                  trace_id = $3,
                  resolved_target_path = $4,
                  error_code = CASE WHEN $2::varchar = 'success' THEN NULL ELSE COALESCE(error_code, 'INSTALL_FAILED') END,
                  error_message = CASE WHEN $2::varchar = 'success' THEN NULL ELSE COALESCE(error_message, 'install operation failed') END,
                  updated_at = NOW(),
                  updated_by = $5
              WHERE id = $1
            `,
            [installRecordId, payload.finalStatus, payload.traceId, resolvedTargetPath, actor.userId]
          );

          await tx.query(
            `
              UPDATE install_ticket
              SET status = CASE WHEN status = 'issued' THEN 'consumed' ELSE status END,
                  consumed_at = CASE WHEN consumed_at IS NULL THEN NOW() ELSE consumed_at END,
                  updated_at = NOW(),
                  updated_by = $2
              WHERE install_record_id = $1
            `,
            [installRecordId, actor.userId]
          );
        }
      );
    });

    return { ok: true };
  }

  private async prepareInstallTarget(
    tx: PoolClient,
    input: CreateInstallTicketRequestDto,
    userId: number
  ): Promise<PreparedInstallTarget> {
    const toolResult = await tx.query<{ user_id: number; client_device_id: number; trust_status: string }>(
      `SELECT user_id, client_device_id, trust_status FROM tool_instance WHERE id = $1`,
      [input.toolInstanceId]
    );
    const tool = toolResult.rows[0];
    if (!tool) {
      throw new AppException('PERM_NO_USE_PERMISSION', 403, 'tool instance not found');
    }
    if (tool.user_id !== userId) {
      throw new AppException('PERM_NO_USE_PERMISSION', 403, 'tool instance forbidden');
    }
    if (tool.trust_status !== 'verified') {
      throw new AppException('TOOL_NOT_SUPPORTED', 422, 'only verified tool instances are installable in this flow');
    }

    const prepared = await tx.query<PreparedInstallTarget>(
      `
        SELECT
          ti.id AS "toolInstanceId",
          ti.client_device_id AS "clientDeviceId",
          ti.os_type AS "osType",
          ti.trust_status AS "trustStatus",
          s.id AS "skillId",
          sv.id AS "skillVersionId",
          s.skill_key AS "skillKey",
          sv.package_uri AS "packageUri",
          sv.checksum AS "checksum",
          sv.signature AS "signature",
          tpl.id AS "templateId",
          tpl.template_code AS "templateCode",
          tpl.template_revision AS "templateRevision",
          tpl.target_path_template AS "targetPathTemplate",
          tpl.filename_template AS "filenameTemplate",
          tpl.packaging_mode AS "packagingMode",
          tpl.content_management_mode AS "contentManagementMode",
          tpl.managed_block_marker AS "managedBlockMarker",
          ARRAY(SELECT jsonb_array_elements_text(tpl.path_variables_json)) AS "pathVariables",
          wr.workspace_path AS "workspacePath",
          wr.id AS "workspaceRegistryId"
        FROM tool_instance ti
        JOIN skill s ON s.id = $1
        JOIN skill_version sv ON sv.id = $2 AND sv.skill_id = s.id
        LEFT JOIN workspace_registry wr
          ON wr.id = $3
         AND wr.user_id = ti.user_id
         AND wr.client_device_id = ti.client_device_id
        JOIN ai_tool_install_target_template tpl
          ON tpl.tool_id = ti.tool_id
         AND tpl.os_type = ti.os_type
         AND tpl.scope_type = $4
         AND tpl.release_status = 'active'
         AND tpl.verification_status = 'verified'
        WHERE ti.id = $5
        ORDER BY tpl.priority ASC
        LIMIT 1
      `,
      [input.skillId, input.skillVersionId, input.workspaceRegistryId ?? null, input.targetScope, input.toolInstanceId]
    );

    if (prepared.rows.length === 0) {
      throw new AppException('TEMPLATE_NOT_AVAILABLE', 422, 'no active template found for requested scope');
    }
    if (input.targetScope === 'project' && !prepared.rows[0].workspaceRegistryId) {
      throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, 'project install requires workspaceRegistryId');
    }

    return prepared.rows[0];
  }

  private buildTemplateVariables(workspacePath: string | null, skillKey: string): Record<string, string> {
    const vars: Record<string, string> = {
      skillKey,
      userHome: process.env.DEFAULT_USER_HOME ?? 'C:/Users/prime'
    };
    if (workspacePath) {
      vars.workspaceRoot = workspacePath;
    }
    return vars;
  }

  private buildResolvedTargetPath(
    targetPathTemplate: string,
    filenameTemplate: string | null,
    vars: Record<string, string>
  ): string {
    const target = this.renderTemplate(targetPathTemplate, vars);
    if (!filenameTemplate) {
      return this.validateResolvedPath(target);
    }
    return this.validateResolvedPath(`${target}/${this.renderTemplate(filenameTemplate, vars)}`);
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_part, key: string) => {
      const value = vars[key];
      if (!value) {
        throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, `missing template variable: ${key}`);
      }
      return value;
    });
  }

  private buildManifestSnapshot(
    ticketId: string,
    installRecordId: number,
    prepared: PreparedInstallTarget,
    variables: Record<string, string>,
    retryToken: string | null
  ): InstallManifestResponseDto {
    const manifest: InstallManifestResponseDto = {
      ticketId,
      installRecordId,
      package: {
        uri: prepared.packageUri,
        checksum: prepared.checksum,
        signature: prepared.signature ?? undefined
      },
      template: {
        templateId: prepared.templateId,
        templateCode: prepared.templateCode,
        templateRevision: prepared.templateRevision,
        targetPathTemplate: prepared.targetPathTemplate,
        filenameTemplate: prepared.filenameTemplate ?? undefined,
        packagingMode: prepared.packagingMode,
        contentManagementMode: prepared.contentManagementMode,
        managedBlockMarker: prepared.managedBlockMarker ?? undefined
      },
      variables,
      verifyRules: ['checksum', 'signature']
    };
    if (retryToken) {
      manifest.retryToken = retryToken;
    }
    return manifest;
  }

  private requireAuth(auth: AuthContext | undefined): AuthContext {
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }
    return auth;
  }

  private requireClientDevice(auth: AuthContext): number {
    if (!auth.clientDeviceId) {
      throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'clientDeviceId missing in token');
    }
    return auth.clientDeviceId;
  }

  private isExpired(ticket: TicketWithRecord): boolean {
    return ticket.expiresAt.getTime() < Date.now();
  }

  private expectedStageFromStatus(status: InstallStatus) {
    if (INSTALL_STAGE_ORDER.includes(status as (typeof INSTALL_STAGE_ORDER)[number])) {
      return status as (typeof INSTALL_STAGE_ORDER)[number];
    }
    throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, `unexpected install status: ${status}`);
  }

  private nextStatusForStage(stage: (typeof INSTALL_STAGE_ORDER)[number]): InstallStatus {
    const idx = INSTALL_STAGE_ORDER.indexOf(stage);
    if (idx < 0) {
      throw new AppException('INSTALL_RECORD_STATUS_CONFLICT', 409, `invalid stage: ${stage}`);
    }
    return (INSTALL_STAGE_ORDER[idx + 1] ?? 'committing') as InstallStatus;
  }

  private requiresActiveUsePermission(operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback') {
    return operationType === 'install' || operationType === 'upgrade';
  }

  private assertFinalStatusMatchesOperation(
    operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback',
    finalStatus: ReportInstallOperationRequestDto['finalStatus']
  ) {
    if (operationType === 'rollback') {
      if (finalStatus === 'success') {
        throw new AppException(
          'INSTALL_RECORD_STATUS_CONFLICT',
          409,
          'rollback operations must report rolled_back instead of success'
        );
      }
      return;
    }

    if (finalStatus === 'rolled_back') {
      throw new AppException(
        'INSTALL_RECORD_STATUS_CONFLICT',
        409,
        `${operationType} operations cannot report rolled_back`
      );
    }
  }

  private async loadTicketContext(
    ticketId: string,
    auth: AuthContext,
    deviceToken: string,
    forUpdate: boolean,
    tx?: PoolClient
  ): Promise<TicketWithRecord> {
    const query = `
      SELECT
        t.ticket_id,
        t.install_record_id,
        t.user_id,
        t.client_device_id,
        ir.operation_type,
        ir.skill_id,
        ir.skill_version_id,
        t.status,
        t.consume_mode,
        t.retry_token,
        t.expires_at,
        t.manifest_snapshot_json,
        ir.install_status,
        ir.status_version,
        ir.resolved_target_path,
        ir.lock_key,
        cd.device_fingerprint
      FROM install_ticket t
      JOIN install_record ir ON ir.id = t.install_record_id
      JOIN client_device cd ON cd.id = t.client_device_id
      WHERE t.ticket_id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `;

    const ticketQuery = tx
      ? await tx.query<{
          ticket_id: string;
          install_record_id: number;
          user_id: number;
          client_device_id: number;
          operation_type: 'install' | 'upgrade' | 'uninstall' | 'rollback';
          skill_id: number;
          skill_version_id: number;
          status: 'issued' | 'consumed' | 'expired' | 'cancelled';
          consume_mode: 'one_time' | 'idempotent_retry';
          retry_token: string | null;
          expires_at: Date;
          manifest_snapshot_json: InstallManifestResponseDto;
          install_status: InstallStatus;
          status_version: number;
          resolved_target_path: string;
          lock_key: string;
          device_fingerprint: string;
        }>(query, [ticketId])
      : await this.db.query<{
          ticket_id: string;
          install_record_id: number;
          user_id: number;
          client_device_id: number;
          operation_type: 'install' | 'upgrade' | 'uninstall' | 'rollback';
          skill_id: number;
          skill_version_id: number;
          status: 'issued' | 'consumed' | 'expired' | 'cancelled';
          consume_mode: 'one_time' | 'idempotent_retry';
          retry_token: string | null;
          expires_at: Date;
          manifest_snapshot_json: InstallManifestResponseDto;
          install_status: InstallStatus;
          status_version: number;
          resolved_target_path: string;
          lock_key: string;
          device_fingerprint: string;
        }>(query, [ticketId]);

    const ticket = ticketQuery.rows[0];
    if (!ticket) {
      throw new AppException('TICKET_NOT_FOUND', 404, 'ticket not found');
    }
    if (ticket.user_id !== auth.userId || ticket.client_device_id !== auth.clientDeviceId) {
      throw new AppException('PERM_NO_USE_PERMISSION', 403, 'ticket binding mismatch');
    }
    if (ticket.device_fingerprint !== deviceToken) {
      throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'device token mismatch');
    }

    return {
      ticketId: ticket.ticket_id,
      installRecordId: ticket.install_record_id,
      userId: ticket.user_id,
      clientDeviceId: ticket.client_device_id,
      operationType: ticket.operation_type,
      skillId: ticket.skill_id,
      skillVersionId: ticket.skill_version_id,
      status: ticket.status,
      consumeMode: ticket.consume_mode,
      retryToken: ticket.retry_token,
      expiresAt: ticket.expires_at,
      manifestSnapshot: ticket.manifest_snapshot_json,
      installStatus: ticket.install_status,
      statusVersion: ticket.status_version,
      resolvedTargetPath: ticket.resolved_target_path,
      lockKey: ticket.lock_key,
      deviceFingerprint: ticket.device_fingerprint
    };
  }

  private assertRetryToken(ticket: TicketWithRecord, retryToken: string | undefined) {
    if (ticket.consumeMode !== 'idempotent_retry') {
      return;
    }
    if (!ticket.retryToken || !retryToken || retryToken !== ticket.retryToken) {
      throw new AppException('TICKET_RETRY_TOKEN_MISMATCH', 409, 'retry token mismatch');
    }
  }

  private isIdempotentRetryOfSuccessfulStage(
    ticket: TicketWithRecord,
    stage: (typeof INSTALL_STAGE_ORDER)[number],
    result: 'ok' | 'failed'
  ) {
    if (ticket.consumeMode !== 'idempotent_retry' || result !== 'ok') {
      return false;
    }
    return ticket.installStatus === this.nextStatusForStage(stage);
  }

  private validateTemplateVariables(prepared: PreparedInstallTarget, vars: Record<string, string>) {
    const required = new Set(prepared.pathVariables ?? []);
    const used = new Set<string>([
      ...this.extractTemplateVariables(prepared.targetPathTemplate),
      ...this.extractTemplateVariables(prepared.filenameTemplate ?? '')
    ]);

    if (used.size === 0) {
      throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, 'template must include at least one variable');
    }

    for (const key of used) {
      if (!required.has(key)) {
        throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, `undeclared template variable: ${key}`);
      }
      if (!vars[key]) {
        throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, `missing template variable value: ${key}`);
      }
    }
  }

  private extractTemplateVariables(template: string): string[] {
    const vars = new Set<string>();
    template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_part, key: string) => {
      vars.add(key);
      return '';
    });
    return [...vars];
  }

  private validateResolvedPath(path: string): string {
    const normalized = path.trim();
    if (!normalized) {
      throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, 'resolved target path is empty');
    }
    if (normalized.includes('${')) {
      throw new AppException('INVALID_TEMPLATE_VARIABLES', 422, 'unresolved template variable in target path');
    }
    return normalized;
  }
}
