import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import type { RequestWithContext } from '../../common/http.types';
import { TemplateService } from './template.service';
import type { PublishTemplateResponse } from './template.types';
import { PublishTemplateRequestDto } from './template.types';

const TEMPLATE_ADMIN_ROLES = new Set(['platform_admin', 'security_admin', 'dept_admin']);

@Controller()
export class TemplateController {
  constructor(@Inject(TemplateService) private readonly templateService: TemplateService) {}

  @Post('/api/admin/ai-tool-templates')
  @HttpCode(201)
  async publishTemplate(
    @Req() req: RequestWithContext,
    @Body() body: PublishTemplateRequestDto
  ): Promise<PublishTemplateResponse> {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    const hasRole = auth.roleCodes.some((role) => TEMPLATE_ADMIN_ROLES.has(role));
    if (!hasRole) {
      throw new AppException('PERM_ROLE_FORBIDDEN', 403, 'role forbidden');
    }

    return this.templateService.publishTemplate(body, auth.userId);
  }
}
