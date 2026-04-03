import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res
} from '@nestjs/common';
import type { Response } from 'express';

import { AppException } from '../../common/app.exception';
import type { RequestWithContext } from '../../common/http.types';
import { SkillAdminService } from './skill-admin.service';
import { SkillService } from './skill.service';
import {
  type AdminSkillDetailResponse,
  type AdminSkillEditorOptionsResponse,
  AdminSkillListQueryDto,
  type AdminSkillListItem,
  AdminReviewQueueQueryDto,
  type AdminReviewQueueItem,
  type ApproveReviewResponse,
  ApproveReviewRequestDto,
  type CreateSkillResponse,
  CreateSkillRequestDto,
  type CreateSkillVersionResponse,
  CreateSkillVersionRequestDto,
  ReviewIdParamDto,
  SkillIdParamDto,
  type SubmitSkillReviewResponse,
  SubmitSkillReviewRequestDto
} from './skill.types';

const REVIEW_APPROVER_ROLES = new Set(['platform_admin', 'security_admin', 'dept_admin', 'reviewer']);

@Controller()
export class SkillController {
  constructor(
    @Inject(SkillService) private readonly skillService: SkillService,
    @Inject(SkillAdminService) private readonly skillAdminService: SkillAdminService
  ) {}

  @Post('/api/skills')
  @HttpCode(HttpStatus.CREATED)
  createSkill(
    @Req() req: RequestWithContext,
    @Body() body: CreateSkillRequestDto
  ): Promise<CreateSkillResponse> {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    return this.skillService.createSkill(body, auth);
  }

  @Post('/api/skills/:id/versions')
  @HttpCode(HttpStatus.CREATED)
  createSkillVersion(
    @Req() req: RequestWithContext,
    @Param() params: SkillIdParamDto,
    @Body() body: CreateSkillVersionRequestDto
  ): Promise<CreateSkillVersionResponse> {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    return this.skillService.createVersion(params.id, body, auth);
  }

  @Post('/api/skills/:id/submit-review')
  @HttpCode(HttpStatus.CREATED)
  submitReview(
    @Req() req: RequestWithContext,
    @Param() params: SkillIdParamDto,
    @Body() body: SubmitSkillReviewRequestDto
  ): Promise<SubmitSkillReviewResponse> {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    return this.skillService.submitReview(params.id, body, auth);
  }

  @Post('/api/reviews/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveReview(
    @Req() req: RequestWithContext,
    @Param() params: ReviewIdParamDto,
    @Body() body: ApproveReviewRequestDto
  ): Promise<ApproveReviewResponse> {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    const hasRole = auth.roleCodes.some((role) => REVIEW_APPROVER_ROLES.has(role));
    if (!hasRole) {
      throw new AppException('PERM_ROLE_FORBIDDEN', 403, 'role forbidden');
    }

    return this.skillService.approveReview(params.id, body, auth, req.context?.traceId ?? 'trace-missing');
  }

  @Get('/api/admin/skills')
  listAdminSkills(
    @Req() req: RequestWithContext,
    @Query() query: AdminSkillListQueryDto
  ): Promise<{ items: AdminSkillListItem[] }> {
    return this.skillAdminService.listSkills(query, req.auth);
  }

  @Get('/api/admin/skill-options')
  listAdminSkillOptions(
    @Req() req: RequestWithContext
  ): Promise<AdminSkillEditorOptionsResponse> {
    return this.skillAdminService.listSkillEditorOptions(req.auth);
  }

  @Get('/api/admin/skills/:id')
  getAdminSkillDetail(
    @Req() req: RequestWithContext,
    @Param('id', ParseIntPipe) skillId: number
  ): Promise<AdminSkillDetailResponse> {
    return this.skillAdminService.getSkillDetail(skillId, req.auth);
  }

  @Get('/api/admin/reviews/queue')
  listAdminReviewQueue(
    @Req() req: RequestWithContext,
    @Query() query: AdminReviewQueueQueryDto
  ): Promise<{ items: AdminReviewQueueItem[] }> {
    return this.skillAdminService.listReviewQueue(query, req.auth);
  }

  @Get('/artifacts/skill-version-artifacts/:artifactKey/:fileName')
  async downloadArtifact(
    @Param('artifactKey') artifactKey: string,
    @Res() res: Response
  ) {
    const artifact = await this.skillAdminService.downloadArtifact(artifactKey);
    res.setHeader('content-type', artifact.mimeType);
    res.setHeader('content-length', artifact.byteSize.toString());
    res.setHeader('content-disposition', `inline; filename="${artifact.fileName}"`);
    res.setHeader('x-primeskill-checksum', artifact.sha256);
    res.setHeader('cache-control', 'private, max-age=60');
    res.end(artifact.bytes);
  }
}
