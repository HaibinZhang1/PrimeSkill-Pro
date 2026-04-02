#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use prime_skill_native_core::native_bootstrap_status as build_native_bootstrap_status;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBootstrapStatusPayload {
    namespace: String,
    managed_block_begin: String,
    managed_block_end: String,
    sample_target_path: String,
}

#[tauri::command]
fn native_bootstrap_status() -> NativeBootstrapStatusPayload {
    let status = build_native_bootstrap_status();

    NativeBootstrapStatusPayload {
        namespace: status.namespace,
        managed_block_begin: status.managed_block_begin,
        managed_block_end: status.managed_block_end,
        sample_target_path: status.sample_target_path,
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![native_bootstrap_status])
        .run(tauri::generate_context!())
        .expect("failed to run PrimeSkill desktop shell");
}
