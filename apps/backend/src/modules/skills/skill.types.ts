import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

export class SkillIdParamDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  id!: number;
}

export class ReviewIdParamDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  id!: number;
}

export class CreateSkillRequestDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,127}$/)
  skillKey!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(256)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  categoryId?: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['public', 'department', 'private'])
  visibilityType: 'public' | 'department' | 'private' = 'department';

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds?: number[];
}

export interface CreateSkillResponse {
  skillId: number;
  status: 'draft';
}

export class CreateSkillVersionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsString()
  @IsUrl({
    require_tld: false,
    require_protocol: true
  })
  packageUri!: string;

  @IsOptional()
  @IsObject()
  manifestJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  readmeText?: string;

  @IsOptional()
  @IsString()
  changelog?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiToolsJson?: string[];

  @IsOptional()
  @IsObject()
  installModeJson?: Record<string, unknown>;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  checksum!: string;

  @IsOptional()
  @IsString()
  signature?: string;
}

export interface CreateSkillVersionResponse {
  skillVersionId: number;
  reviewStatus: 'pending';
  stage1IndexStatus: 'pending';
  stage2IndexStatus: 'pending';
}

export class SubmitSkillReviewRequestDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  skillVersionId!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  reviewerId?: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

export interface SubmitSkillReviewResponse {
  reviewTaskId: number;
  status: 'created' | 'assigned';
  reviewRound: number;
}

export class ApproveReviewRequestDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export interface ApproveReviewResponse {
  reviewTaskId: number;
  skillId: number;
  skillVersionId: number;
  skillStatus: 'published';
  reviewStatus: 'approved';
  stage1JobId: string;
}
