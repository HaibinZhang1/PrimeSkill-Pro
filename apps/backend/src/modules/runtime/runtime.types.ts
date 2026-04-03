import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from 'class-validator';

export class RegisterClientDeviceRequestDto {
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  deviceFingerprint!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  deviceName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  osType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  desktopAppVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  nativeCoreVersion?: string;
}

export interface RegisterClientDeviceResponse {
  clientDeviceId: number;
  deviceFingerprint: string;
  status: 'active' | 'revoked' | 'offline';
  lastSeenAt: string;
}

export class ReportToolInstanceItemDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  toolCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  toolVersion?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  osType!: string;

  @IsOptional()
  @IsString()
  detectedInstallPath?: string;

  @IsOptional()
  @IsString()
  detectedConfigPath?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  discoveredTargets?: string[];

  @IsOptional()
  @IsIn(['auto', 'manual', 'imported'])
  detectionSource?: 'auto' | 'manual' | 'imported';

  @IsOptional()
  @IsIn(['detected', 'verified', 'disabled'])
  trustStatus?: 'detected' | 'verified' | 'disabled';
}

export class ReportToolInstancesRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportToolInstanceItemDto)
  items!: ReportToolInstanceItemDto[];
}

export interface MyToolInstanceDto {
  toolInstanceId: number;
  clientDeviceId: number;
  toolCode: string;
  toolName: string;
  toolVersion?: string;
  osType: string;
  detectedInstallPath?: string;
  detectedConfigPath?: string;
  discoveredTargets: string[];
  detectionSource: 'auto' | 'manual' | 'imported';
  trustStatus: 'detected' | 'verified' | 'disabled';
  lastScannedAt?: string;
}

export interface ReportToolInstancesResponse {
  items: MyToolInstanceDto[];
}

export class ReportWorkspaceItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  workspaceName?: string;

  @IsString()
  @MinLength(2)
  workspacePath!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(128)
  projectFingerprint!: string;

  @IsOptional()
  @IsString()
  repoRemote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  repoBranch?: string;
}

export class ReportWorkspacesRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportWorkspaceItemDto)
  items!: ReportWorkspaceItemDto[];
}

export interface MyWorkspaceDto {
  workspaceRegistryId: number;
  clientDeviceId: number;
  workspaceName?: string;
  workspacePath: string;
  projectFingerprint: string;
  repoRemote?: string;
  repoBranch?: string;
  lastUsedAt?: string;
  updatedAt: string;
}

export interface ReportWorkspacesResponse {
  items: MyWorkspaceDto[];
}

export interface MyInstallDto {
  bindingId: number;
  installRecordId: number;
  skillId: number;
  skillVersionId: number;
  skillKey: string;
  skillName: string;
  skillVersion: string;
  toolInstanceId?: number;
  toolCode?: string;
  toolName?: string;
  targetScope: 'global' | 'project';
  workspaceRegistryId?: number;
  workspaceName?: string;
  workspacePath?: string;
  resolvedTargetPath: string;
  installStatus: string;
  installedAt: string;
  lastVerifiedAt?: string;
  state: 'active' | 'removed' | 'drifted';
}

export interface MyInstallManifestSummaryDto {
  ticketId?: string;
  templateCode?: string;
  packagingMode?: string;
  contentManagementMode?: string;
  targetPathTemplate?: string;
  filenameTemplate?: string;
  packageUri?: string;
}

export interface MyInstallDetailDto extends MyInstallDto {
  operationType: 'install' | 'upgrade' | 'uninstall' | 'rollback';
  traceId?: string;
  manifest?: MyInstallManifestSummaryDto;
}

export class ReportInstallVerificationRequestDto {
  @IsIn(['verified', 'drifted'])
  verificationStatus!: 'verified' | 'drifted';

  @IsOptional()
  @IsString()
  resolvedTargetPath?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  driftReasons?: string[];

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  traceId!: string;
}

export interface ReportInstallVerificationResponse {
  bindingId: number;
  installRecordId: number;
  state: 'active' | 'drifted';
  lastVerifiedAt: string;
}
