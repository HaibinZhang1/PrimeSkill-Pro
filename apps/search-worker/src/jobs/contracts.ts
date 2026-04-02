export interface Stage1IndexJob {
  jobType: 'Stage1IndexJob';
  jobId: string;
  skillVersionId: number;
  traceId: string;
  retry: number;
}

export interface Stage2IndexJob {
  jobType: 'Stage2IndexJob';
  jobId: string;
  skillVersionId: number;
  chunkPolicy: string;
  traceId: string;
}

export interface SearchAssembleJob {
  jobType: 'SearchAssembleJob';
  requestId: string;
  userId: number;
  query: string;
  permissionDigest: string;
  candidateIds: number[];
  traceId: string;
}

export interface ReconcileJob {
  jobType: 'ReconcileJob';
  clientDeviceId: number;
  installRecordId: number;
  reason: string;
  traceId: string;
}

export type QueueJob = Stage1IndexJob | Stage2IndexJob | SearchAssembleJob | ReconcileJob;
