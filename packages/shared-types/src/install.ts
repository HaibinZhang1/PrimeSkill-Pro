export type InstallOperationType = 'install' | 'upgrade' | 'uninstall' | 'rollback';

export type InstallStatus =
  | 'pending'
  | 'ticket_issued'
  | 'downloading'
  | 'staging'
  | 'verifying'
  | 'committing'
  | 'success'
  | 'failed'
  | 'rolling_back'
  | 'rolled_back'
  | 'cancelled';

export type ConsumeMode = 'one_time' | 'idempotent_retry';

export interface InstallLockScope {
  clientDeviceId: number;
  resolvedTargetPath: string;
}
