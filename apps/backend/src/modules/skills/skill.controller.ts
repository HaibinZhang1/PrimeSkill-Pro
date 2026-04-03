import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import type { RequestWithContext } from '../../common/http.types';
import { SkillService } from './skill.service';
import {
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
  constructor(@Inject(SkillService) private readonly skillService: SkillService) {}

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
}
