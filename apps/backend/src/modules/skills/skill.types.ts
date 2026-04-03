import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  MinLength,
  ValidateNested
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

export class InlineArtifactEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  path!: string;

  @IsString()
  content!: string;
}

export class InlineArtifactDto {
  @IsOptional()
  @IsIn(['zip', 'legacy_json'])
  format: 'zip' | 'legacy_json' = 'zip';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InlineArtifactEntryDto)
  entries!: InlineArtifactEntryDto[];
}

export class CreateSkillVersionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  version!: string;

  @IsOptional()
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

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  checksum!: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InlineArtifactDto)
  artifact?: InlineArtifactDto;
}

export interface CreateSkillVersionResponse {
  skillVersionId: number;
  reviewStatus: 'pending';
  stage1IndexStatus: 'pending';
  stage2IndexStatus: 'pending';
  packageUri: string;
  checksum: string;
  packageSource: 'external' | 'internal';
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

export class AdminSkillListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @IsOptional()
  @IsIn(['draft', 'pending_review', 'approved', 'published', 'rejected', 'archived'])
  skillStatus?: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  reviewStatus?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit = 50;
}

export class AdminReviewQueueQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit = 50;
}

export interface AdminArtifactSummary {
  packageSource: 'external' | 'internal';
  packageUri: string;
  checksum: string;
  packageFormat?: 'zip' | 'legacy_json';
  fileName?: string;
  byteSize?: number;
  entryCount?: number;
}

export interface AdminReviewTaskSummary {
  reviewTaskId: number;
  skillVersionId: number;
  version: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  taskStatus: 'created' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'closed';
  reviewRound: number;
  submitterId: number;
  submitterDisplayName?: string;
  reviewerId?: number;
  reviewerDisplayName?: string;
  comment?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface AdminSkillVersionSummary {
  skillVersionId: number;
  version: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  packageUri: string;
  checksum: string;
  publishedAt?: string;
  createdAt: string;
  artifact: AdminArtifactSummary;
}

export interface AdminSkillListItem {
  skillId: number;
  skillKey: string;
  name: string;
  summary?: string;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  visibilityType: 'public' | 'department' | 'private';
  ownerUserId: number;
  ownerDisplayName?: string;
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  categoryName?: string;
  updatedAt: string;
  currentVersion?: AdminSkillVersionSummary;
  activeReviewTask?: AdminReviewTaskSummary;
}

export interface AdminSkillDetailResponse {
  skillId: number;
  skillKey: string;
  name: string;
  summary?: string;
  description?: string;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  visibilityType: 'public' | 'department' | 'private';
  ownerUserId: number;
  ownerDisplayName?: string;
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  categoryName?: string;
  tags: Array<{ tagId: number; name: string }>;
  versions: AdminSkillVersionSummary[];
  reviewTasks: AdminReviewTaskSummary[];
  updatedAt: string;
}

export interface AdminSkillOptionItem {
  id: number;
  name: string;
}

export interface AdminSkillEditorOptionsResponse {
  categories: AdminSkillOptionItem[];
  tags: AdminSkillOptionItem[];
}

export interface AdminReviewQueueItem extends AdminReviewTaskSummary {
  skillId: number;
  skillKey: string;
  skillName: string;
  skillStatus: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'archived';
  ownerDepartmentId?: number;
  ownerDepartmentName?: string;
  artifact: AdminArtifactSummary;
}
