import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

export const INSTALL_STAGE_ORDER = ['ticket_issued', 'downloading', 'staging', 'verifying', 'committing'] as const;
export type InstallStage = (typeof INSTALL_STAGE_ORDER)[number];

export class CreateInstallTicketRequestDto {
  @IsInt()
  @Type(() => Number)
  skillId!: number;

  @IsInt()
  @Type(() => Number)
  skillVersionId!: number;

  @IsIn(['install', 'upgrade', 'uninstall', 'rollback'])
  operationType!: 'install' | 'upgrade' | 'uninstall' | 'rollback';

  @IsIn(['global', 'project'])
  targetScope!: 'global' | 'project';

  @IsInt()
  @Type(() => Number)
  toolInstanceId!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  workspaceRegistryId?: number;

  @IsString()
  @MinLength(12)
  idempotencyKey!: string;
}

export interface InstallTicketPayload {
  ticketId: string;
  installRecordId: number;
  consumeMode: 'one_time' | 'idempotent_retry';
  retryToken?: string;
  expiresAt: string;
}

export class ConsumeInstallTicketRequestDto {
  @IsInt()
  @Type(() => Number)
  installRecordId!: number;

  @IsIn(INSTALL_STAGE_ORDER)
  stage!: InstallStage;

  @IsIn(['ok', 'failed'])
  result!: 'ok' | 'failed';

  @IsString()
  @MinLength(2)
  traceId!: string;

  @IsOptional()
  @IsObject()
  telemetry?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MinLength(8)
  retryToken?: string;
}

export class ReportInstallOperationRequestDto {
  @IsIn(['success', 'failed', 'rolled_back', 'cancelled'])
  finalStatus!: 'success' | 'failed' | 'rolled_back' | 'cancelled';

  @IsOptional()
  @IsString()
  resolvedTargetPath?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  managedFileHashes?: string[];

  @IsOptional()
  @IsString()
  backupSnapshotPath?: string;

  @IsString()
  @MinLength(2)
  traceId!: string;
}

export class InstallManifestPackageDto {
  @IsString()
  uri!: string;

  @IsString()
  checksum!: string;

  @IsOptional()
  @IsString()
  signature?: string;
}

export class InstallManifestTemplateDto {
  @IsInt()
  @Type(() => Number)
  templateId!: number;

  @IsString()
  templateCode!: string;

  @IsInt()
  @Type(() => Number)
  templateRevision!: number;

  @IsString()
  targetPathTemplate!: string;

  @IsOptional()
  @IsString()
  filenameTemplate?: string;

  @IsString()
  packagingMode!: string;

  @IsString()
  contentManagementMode!: string;

  @IsOptional()
  @IsString()
  managedBlockMarker?: string;
}

export class InstallManifestResponseDto {
  @IsString()
  ticketId!: string;

  @IsInt()
  @Type(() => Number)
  installRecordId!: number;

  @ValidateNested()
  @Type(() => InstallManifestPackageDto)
  package!: InstallManifestPackageDto;

  @ValidateNested()
  @Type(() => InstallManifestTemplateDto)
  template!: InstallManifestTemplateDto;

  @IsObject()
  variables!: Record<string, string>;

  @IsArray()
  @IsString({ each: true })
  verifyRules!: string[];

  @IsOptional()
  @IsString()
  retryToken?: string;
}

export class TicketIdParamDto {
  @IsString()
  @Matches(/^tk_[A-Za-z0-9_-]+$/)
  @MaxLength(128)
  ticketId!: string;
}

export class InstallRecordIdParamDto {
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  installRecordId!: number;
}
