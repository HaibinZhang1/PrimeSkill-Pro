import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { AppException } from './app.exception';
import type { RequestWithContext } from './http.types';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithContext>();
    const res = ctx.getResponse<Response>();

    const context = req.context ?? {
      requestId: 'unknown',
      traceId: 'unknown'
    };

    if (exception instanceof AppException) {
      res.status(exception.status).json({
        code: exception.code,
        message: exception.message,
        requestId: context.requestId,
        traceId: context.traceId
      });
      return;
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({
        code: 'HTTP_EXCEPTION',
        message: exception.message,
        requestId: context.requestId,
        traceId: context.traceId
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : 'internal error';
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message,
      requestId: context.requestId,
      traceId: context.traceId
    });
  }
}
