import type { Request } from 'express';

export interface AuthContext {
  userId: number;
  clientDeviceId?: number;
  departmentIds: number[];
  roleCodes: string[];
  rawToken: string;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
}

export type RequestWithContext = Request & {
  auth?: AuthContext;
  context?: RequestContext;
};
