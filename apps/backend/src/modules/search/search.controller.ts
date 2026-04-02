import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { AppException } from '../../common/app.exception';
import type { RequestWithContext } from '../../common/http.types';
import { SearchService } from './search.service';
import { SearchSkillsRequestDto } from './search.types';

@Controller()
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Post('/api/desktop/search/skills')
  @HttpCode(200)
  async searchSkills(@Req() req: RequestWithContext, @Body() body: SearchSkillsRequestDto) {
    const auth = req.auth;
    if (!auth) {
      throw new AppException('AUTH_UNAUTHORIZED', 401, 'authorization required');
    }

    return this.searchService.search(
      {
        query: body.query,
        page: body.page,
        pageSize: body.pageSize,
        toolContext: body.toolContext,
        workspaceContext: body.workspaceContext
      },
      {
        userId: auth.userId,
        departmentIds: auth.departmentIds,
        roleCodes: auth.roleCodes
      }
    );
  }
}
