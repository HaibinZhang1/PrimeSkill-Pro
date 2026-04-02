import { invoke } from '@tauri-apps/api/core';

export interface NativeBootstrapStatus {
  namespace: string;
  managedBlockBegin: string;
  managedBlockEnd: string;
  sampleTargetPath: string;
}

function hasTauriRuntime() {
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
