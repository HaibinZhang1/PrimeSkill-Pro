import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface NativeBootstrapStatus {
  namespace: string;
  managedBlockBegin: string;
  managedBlockEnd: string;
  sampleTargetPath: string;
}

export interface NativeClientDevice {
  deviceFingerprint: string;
  deviceName: string;
  osType: string;
  desktopAppVersion: string;
  nativeCoreVersion: string;
}

export interface NativeToolDiscoveryItem {
  toolCode: string;
  toolVersion?: string;
  osType: string;
  detectedInstallPath?: string;
  detectedConfigPath?: string;
  discoveredTargets: string[];
  detectionSource: string;
  trustStatus: string;
}

export interface NativeListToolInstancesResponse {
  clientDevice: NativeClientDevice;
  items: NativeToolDiscoveryItem[];
}

export interface NativeWorkspaceSelection {
  workspaceName: string;
  workspacePath: string;
  projectFingerprint: string;
  repoRemote?: string;
  repoBranch?: string;
}

export interface NativePreviewInstallTargetInput {
  toolCode: string;
  scopeType: string;
  skillKey: string;
  workspacePath: string;
}

export interface NativePreviewInstallTarget {
  toolCode: string;
  scopeType: string;
  templateCode: string;
  resolvedTargetPath: string;
  resolvedFilename?: string;
  packagingMode: string;
  verificationStatus: string;
}

export interface NativeApplyInstallTicketInput {
  apiBaseUrl: string;
  authToken: string;
  deviceToken: string;
  ticketId: string;
  traceId: string;
}

export interface NativeApplyInstallTicketResult {
  ticketId: string;
  installRecordId: number;
  finalStatus: string;
  resolvedTargetPath: string;
  managedFileHashes: string[];
  localRegistryPath: string;
}

export interface NativeInstallProgressEvent {
  installRecordId: number;
  ticketId: string;
  traceId: string;
  stage: string;
  timestamp: string;
}

export interface NativeLocalInstallRecord {
  installRecordId: number;
  ticketId: string;
  skillKey: string;
  templateCode: string;
  resolvedTargetPath: string;
  installedAt: string;
}

export function hasTauriRuntime() {
  return '__TAURI_INTERNALS__' in window;
}

export async function loadNativeBootstrapStatus(): Promise<NativeBootstrapStatus> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }

  return invoke<NativeBootstrapStatus>('native_bootstrap_status');
}

export function tauriRuntimeLabel() {
  return hasTauriRuntime() ? 'tauri-hosted' : 'web-preview';
}

export async function listToolInstancesNative(): Promise<NativeListToolInstancesResponse> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }
  return invoke<NativeListToolInstancesResponse>('list_tool_instances');
}

export async function selectWorkspaceNative(workspacePath?: string): Promise<NativeWorkspaceSelection> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }
  return invoke<NativeWorkspaceSelection>('select_workspace', {
    input: workspacePath ? { workspacePath } : undefined
  });
}

export async function previewInstallTargetNative(
  input: NativePreviewInstallTargetInput
): Promise<NativePreviewInstallTarget> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }
  return invoke<NativePreviewInstallTarget>('preview_install_target', { input });
}

export async function applyInstallTicketNative(
  input: NativeApplyInstallTicketInput
): Promise<NativeApplyInstallTicketResult> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }
  return invoke<NativeApplyInstallTicketResult>('apply_install_ticket', { input });
}

export async function listLocalInstallsNative(): Promise<NativeLocalInstallRecord[]> {
  if (!hasTauriRuntime()) {
    throw new Error('tauri runtime unavailable');
  }
  return invoke<NativeLocalInstallRecord[]>('list_local_installs');
}

export async function listenInstallProgressNative(
  handler: (event: NativeInstallProgressEvent) => void
): Promise<() => void> {
  if (!hasTauriRuntime()) {
    return () => {};
  }

  const unlisten = await listen<NativeInstallProgressEvent>('prime-skill://install-progress', (event) => {
    handler(event.payload);
  });

  return unlisten;
}
