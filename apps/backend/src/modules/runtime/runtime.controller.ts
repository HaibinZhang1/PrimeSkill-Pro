import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Req } from '@nestjs/common';

import type { RequestWithContext } from '../../common/http.types';
import { RuntimeService } from './runtime.service';
import {
  RegisterClientDeviceRequestDto,
  ReportInstallVerificationRequestDto,
  ReportToolInstancesRequestDto,
  ReportWorkspacesRequestDto
} from './runtime.types';

@Controller()
export class RuntimeController {
  constructor(@Inject(RuntimeService) private readonly runtimeService: RuntimeService) {}

  @Post('/api/client-devices/register')
  @HttpCode(200)
  registerClientDevice(@Req() req: RequestWithContext, @Body() body: RegisterClientDeviceRequestDto) {
    return this.runtimeService.registerClientDevice(body, req.auth);
  }

  @Post('/api/tool-instances/report')
  @HttpCode(200)
  reportToolInstances(@Req() req: RequestWithContext, @Body() body: ReportToolInstancesRequestDto) {
    return this.runtimeService.reportToolInstances(body, req.auth);
  }

  @Post('/api/workspaces/report')
  @HttpCode(200)
  reportWorkspaces(@Req() req: RequestWithContext, @Body() body: ReportWorkspacesRequestDto) {
    return this.runtimeService.reportWorkspaces(body, req.auth);
  }

  @Get('/api/my/installs')
  getMyInstalls(@Req() req: RequestWithContext) {
    return this.runtimeService.getMyInstalls(req.auth);
  }

  @Get('/api/my/installs/:bindingId')
  getMyInstallDetail(@Req() req: RequestWithContext, @Param('bindingId', ParseIntPipe) bindingId: number) {
    return this.runtimeService.getMyInstallDetail(bindingId, req.auth);
  }

  @Post('/api/my/installs/:bindingId/verify')
  @HttpCode(200)
  reportInstallVerification(
    @Req() req: RequestWithContext,
    @Param('bindingId', ParseIntPipe) bindingId: number,
    @Body() body: ReportInstallVerificationRequestDto
  ) {
    return this.runtimeService.reportInstallVerification(bindingId, body, req.auth);
  }

  @Get('/api/my/tool-instances')
  getMyToolInstances(@Req() req: RequestWithContext) {
    return this.runtimeService.getMyToolInstances(req.auth);
  }

  @Get('/api/my/workspaces')
  getMyWorkspaces(@Req() req: RequestWithContext) {
    return this.runtimeService.getMyWorkspaces(req.auth);
  }
}
