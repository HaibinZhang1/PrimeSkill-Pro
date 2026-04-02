import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';

export class WorkspaceContextDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  workspaceRegistryId?: number;
}

export class SearchSkillsRequestDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  page!: number;

  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  pageSize!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolContext?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceContextDto)
  workspaceContext?: WorkspaceContextDto;
}
