import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

export class PublishTemplateRequestDto {
  @IsInt()
  @Type(() => Number)
  toolId!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  templateCode!: string;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  templateRevision!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  osType!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  artifactType!: string;

  @IsIn(['global', 'project'])
  scopeType!: 'global' | 'project';

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  templateName!: string;

  @IsString()
  @MinLength(2)
  targetPathTemplate!: string;

  @IsOptional()
  @IsString()
  filenameTemplate?: string;

  @IsIn(['single_file', 'directory', 'merge', 'append'])
  packagingMode!: 'single_file' | 'directory' | 'merge' | 'append';

  @IsIn(['replace', 'managed_block'])
  contentManagementMode!: 'replace' | 'managed_block';

  @IsOptional()
  @IsString()
  managedBlockMarker?: string;

  @IsArray()
  @IsString({ each: true })
  pathVariables!: string[];

  @IsOptional()
  @IsString()
  minToolVersion?: string;

  @IsOptional()
  @IsString()
  maxToolVersion?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(9999)
  priority = 100;

  @IsOptional()
  @IsBoolean()
  isDefault = false;

  @IsOptional()
  @IsIn(['active', 'retired', 'draft'])
  releaseStatus: 'active' | 'retired' | 'draft' = 'active';

  @IsOptional()
  @IsIn(['verified', 'candidate', 'deprecated'])
  verificationStatus: 'verified' | 'candidate' | 'deprecated' = 'candidate';

  @IsOptional()
  @IsString()
  sourceReferenceUrl?: string;
}

export interface PublishTemplateResponse {
  templateId: number;
}
