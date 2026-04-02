import { randomUUID } from 'crypto';
import type { NextFunction, Response } from 'express';

import type { RequestWithContext } from './http.types';

export class RequestContextMiddleware {
  static attachContext(req: RequestWithContext, _res: Response, next: NextFunction) {
    const requestId = randomUUID();
    const traceId = (req.header('x-trace-id') ?? requestId).trim();
    req.context = { requestId, traceId };
    next();
  }
}
