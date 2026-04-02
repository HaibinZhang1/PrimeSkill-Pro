export type IpcCommand =
  | 'scan_tools'
  | 'list_tool_instances'
  | 'select_workspace'
  | 'preview_install_target'
  | 'apply_install_ticket'
  | 'upgrade_installation'
  | 'uninstall_installation'
  | 'rollback_installation'
  | 'verify_installation'
  | 'list_local_installs';

export interface IpcEventPayload {
  installRecordId: number;
  ticketId: string;
  traceId: string;
  stage: string;
  timestamp: string;
}

export function commandNamespace(): string {
  return 'tauri://prime-skill';
}
