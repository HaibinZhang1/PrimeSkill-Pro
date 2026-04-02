import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import { AppException } from './app.exception';
import type { AuthContext, RequestWithContext } from './http.types';

interface EncodedAuthToken {
  userId: number;
  clientDeviceId?: number;
  departmentIds?: number[];
  roleCodes?: string[];
}

function parseBearerToken(authorization?: string): string {
  if (!authorization) {
    throw new AppException('AUTH_UNAUTHORIZED', 401, 'missing authorization header');
  }
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppException('AUTH_UNAUTHORIZED', 401, 'invalid authorization scheme');
  }
  return token;
}

function decodeAuthToken(rawToken: string): AuthContext {
  let parsed: EncodedAuthToken;
  try {
    const json = Buffer.from(rawToken, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as EncodedAuthToken;
  } catch {
    throw new AppException('AUTH_UNAUTHORIZED', 401, 'invalid token payload');
  }

  if (!parsed.userId || Number.isNaN(parsed.userId)) {
    throw new AppException('AUTH_UNAUTHORIZED', 401, 'token missing userId');
  }

  return {
    userId: Number(parsed.userId),
    clientDeviceId: parsed.clientDeviceId ? Number(parsed.clientDeviceId) : undefined,
    departmentIds: parsed.departmentIds?.map(Number) ?? [],
    roleCodes: parsed.roleCodes ?? [],
    rawToken
  };
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: RequestWithContext, _res: Response, next: NextFunction) {
    const path = req.originalUrl ?? req.path;
    if (!path.startsWith('/api/')) {
      next();
      return;
    }

    const rawToken = parseBearerToken(req.header('authorization'));
    const auth = decodeAuthToken(rawToken);

    if (path.startsWith('/api/native/') && !req.header('x-device-token')) {
      throw new AppException('AUTH_DEVICE_UNTRUSTED', 401, 'missing x-device-token');
    }

    req.auth = auth;
    next();
  }
}
