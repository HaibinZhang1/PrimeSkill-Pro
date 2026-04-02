import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req
} from '@nestjs/common';

import type { RequestWithContext } from '../../common/http.types';
import { InstallService } from './install.service';
import {
  ConsumeInstallTicketRequestDto,
  CreateInstallTicketRequestDto,
  InstallRecordIdParamDto,
  ReportInstallOperationRequestDto,
  TicketIdParamDto
} from './install.types';

@Controller()
export class InstallController {
  constructor(@Inject(InstallService) private readonly service: InstallService) {}

  @Post('/api/desktop/install-tickets')
  @HttpCode(200)
  createInstallTicket(@Req() req: RequestWithContext, @Body() body: CreateInstallTicketRequestDto) {
    return this.service.createTicket(body, req.auth, req.context?.traceId ?? 'trace-missing');
  }

  @Get('/api/native/install-tickets/:ticketId/manifest')
  getInstallManifest(
    @Req() req: RequestWithContext,
    @Param() params: TicketIdParamDto,
    @Headers('x-device-token') deviceToken: string
  ) {
    return this.service.getManifest(params.ticketId, req.auth, deviceToken);
  }

  @Post('/api/native/install-tickets/:ticketId/consume')
  @HttpCode(200)
  consumeInstallTicket(
    @Req() req: RequestWithContext,
    @Param() params: TicketIdParamDto,
    @Headers('x-device-token') deviceToken: string,
    @Body() body: ConsumeInstallTicketRequestDto
  ) {
    return this.service.consume(params.ticketId, body, req.auth, deviceToken);
  }

  @Post('/api/native/install-operations/:installRecordId/report')
  @HttpCode(200)
  reportInstallOperation(
    @Req() req: RequestWithContext,
    @Param() params: InstallRecordIdParamDto,
    @Headers('x-device-token') deviceToken: string,
    @Body() body: ReportInstallOperationRequestDto
  ) {
    return this.service.reportFinal(params.installRecordId, body, req.auth, deviceToken);
  }
}
