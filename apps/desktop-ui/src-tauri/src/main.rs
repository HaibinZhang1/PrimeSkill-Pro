#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use prime_skill_native_core::{
    execute_install as native_execute_install, execute_rollback as native_execute_rollback,
    execute_uninstall as native_execute_uninstall,
    native_bootstrap_status as build_native_bootstrap_status, parse_install_package,
    preview_install_target as native_preview_install_target,
    verify_installation as native_verify_installation, verify_package_checksum, InstallManifest,
    InstallPackageDocument, InstallProgressEvent, LocalInstallRecord, LocalInstallRegistry,
    LocalInstallationDetail, LocalInstallationVerification, PreviewInstallTarget,
    INSTALL_PROGRESS_EVENT,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeBootstrapStatusPayload {
    namespace: String,
    managed_block_begin: String,
    managed_block_end: String,
    sample_target_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientDevicePayload {
    device_fingerprint: String,
    device_name: String,
    os_type: String,
    desktop_app_version: String,
    native_core_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolInstanceDiscoveryPayload {
    tool_code: String,
    tool_version: Option<String>,
    os_type: String,
    detected_install_path: Option<String>,
    detected_config_path: Option<String>,
    discovered_targets: Vec<String>,
    detection_source: String,
    trust_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListToolInstancesPayload {
    client_device: ClientDevicePayload,
    items: Vec<ToolInstanceDiscoveryPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSelectionPayload {
    workspace_name: String,
    workspace_path: String,
    project_fingerprint: String,
    repo_remote: Option<String>,
    repo_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewInstallTargetInput {
    tool_code: String,
    scope_type: String,
    skill_key: String,
    workspace_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectWorkspaceInput {
    workspace_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyInstallTicketInput {
    api_base_url: String,
    auth_token: String,
    device_token: String,
    ticket_id: String,
    trace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationDetailInput {
    install_record_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyInstallTicketResponse {
    ticket_id: String,
    install_record_id: i64,
    final_status: String,
    resolved_target_path: String,
    managed_file_hashes: Vec<String>,
    local_registry_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsumeInstallTicketRequest {
    install_record_id: i64,
    stage: String,
    result: String,
    trace_id: String,
    retry_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsumeInstallTicketResponse {
    next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportInstallOperationRequest {
    final_status: String,
    resolved_target_path: Option<String>,
    managed_file_hashes: Vec<String>,
    trace_id: String,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            native_bootstrap_status,
            list_tool_instances,
            select_workspace,
            preview_install_target,
            apply_install_ticket,
            uninstall_installation,
            rollback_installation,
            verify_installation,
            get_installation_detail,
            list_local_installs
        ])
        .run(tauri::generate_context!())
        .expect("failed to run PrimeSkill desktop shell");
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

#[tauri::command]
fn list_tool_instances() -> ListToolInstancesPayload {
    ListToolInstancesPayload {
        client_device: ClientDevicePayload {
            device_fingerprint: default_device_token(),
            device_name: "PrimeSkill Desktop".to_string(),
            os_type: "windows".to_string(),
            desktop_app_version: "0.2.0".to_string(),
            native_core_version: env!("CARGO_PKG_VERSION").to_string(),
        },
        items: vec![
            ToolInstanceDiscoveryPayload {
                tool_code: "cursor".to_string(),
                tool_version: Some("0.48.8".to_string()),
                os_type: "windows".to_string(),
                detected_install_path: Some(
                    "C:/Users/Prime/AppData/Local/Programs/Cursor/Cursor.exe".to_string(),
                ),
                detected_config_path: Some("C:/Users/Prime/.cursor".to_string()),
                discovered_targets: vec!["project".to_string()],
                detection_source: "manual".to_string(),
                trust_status: "verified".to_string(),
            },
            ToolInstanceDiscoveryPayload {
                tool_code: "opencode".to_string(),
                tool_version: Some("0.3.1".to_string()),
                os_type: "windows".to_string(),
                detected_install_path: Some(
                    "C:/Users/Prime/AppData/Roaming/npm/opencode.cmd".to_string(),
                ),
                detected_config_path: Some("C:/Users/Prime/.config/opencode".to_string()),
                discovered_targets: vec!["project".to_string()],
                detection_source: "manual".to_string(),
                trust_status: "verified".to_string(),
            },
        ],
    }
}

#[tauri::command]
fn select_workspace(
    input: Option<SelectWorkspaceInput>,
) -> Result<WorkspaceSelectionPayload, String> {
    let selected = input
        .and_then(|value| value.workspace_path)
        .unwrap_or_else(default_workspace_path);

    let path = PathBuf::from(selected);
    let workspace_path = normalize_path(&path);
    let workspace_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("workspace")
        .to_string();

    Ok(WorkspaceSelectionPayload {
        workspace_name,
        workspace_path: workspace_path.clone(),
        project_fingerprint: project_fingerprint(&workspace_path),
        repo_remote: None,
        repo_branch: Some("main".to_string()),
    })
}

#[tauri::command]
fn preview_install_target(
    input: PreviewInstallTargetInput,
) -> Result<PreviewInstallTarget, String> {
    native_preview_install_target(
        &input.tool_code,
        &input.scope_type,
        &input.skill_key,
        &input.workspace_path,
    )
}

#[tauri::command]
async fn apply_install_ticket(
    app: AppHandle,
    input: ApplyInstallTicketInput,
) -> Result<ApplyInstallTicketResponse, String> {
    let manifest = fetch_manifest(&input).await?;
    ensure_supported_manifest(&manifest)?;
    let package = fetch_install_package(&manifest).await?;

    let registry_path = local_registry_path(&app);
    let apply_result = native_execute_install(
        &manifest,
        &package,
        &registry_path,
        &input.trace_id,
        |event| emit_progress_event(&app, event),
    )?;

    for stage in [
        "ticket_issued",
        "downloading",
        "staging",
        "verifying",
        "committing",
    ] {
        let consume_response = consume_stage(&input, &manifest, stage).await?;
        if consume_response.next_action == "abort" {
            return Err("backend asked install flow to abort".to_string());
        }
    }

    report_final(
        &input,
        manifest.install_record_id,
        &apply_result.final_status,
        Some(apply_result.resolved_target_path.clone()),
        apply_result.managed_file_hashes.clone(),
    )
    .await?;

    Ok(ApplyInstallTicketResponse {
        ticket_id: manifest.ticket_id,
        install_record_id: manifest.install_record_id,
        final_status: apply_result.final_status,
        resolved_target_path: apply_result.resolved_target_path,
        managed_file_hashes: apply_result.managed_file_hashes,
        local_registry_path: apply_result.local_registry_path,
    })
}

#[tauri::command]
async fn uninstall_installation(
    app: AppHandle,
    input: ApplyInstallTicketInput,
) -> Result<ApplyInstallTicketResponse, String> {
    let manifest = fetch_manifest(&input).await?;
    ensure_supported_manifest(&manifest)?;

    let registry_path = local_registry_path(&app);
    let apply_result =
        native_execute_uninstall(&manifest, &registry_path, &input.trace_id, |event| {
            emit_progress_event(&app, event)
        })?;

    for stage in [
        "ticket_issued",
        "downloading",
        "staging",
        "verifying",
        "committing",
    ] {
        let consume_response = consume_stage(&input, &manifest, stage).await?;
        if consume_response.next_action == "abort" {
            return Err("backend asked uninstall flow to abort".to_string());
        }
    }

    report_final(
        &input,
        manifest.install_record_id,
        &apply_result.final_status,
        Some(apply_result.resolved_target_path.clone()),
        apply_result.managed_file_hashes.clone(),
    )
    .await?;

    Ok(ApplyInstallTicketResponse {
        ticket_id: manifest.ticket_id,
        install_record_id: manifest.install_record_id,
        final_status: apply_result.final_status,
        resolved_target_path: apply_result.resolved_target_path,
        managed_file_hashes: apply_result.managed_file_hashes,
        local_registry_path: apply_result.local_registry_path,
    })
}

#[tauri::command]
async fn rollback_installation(
    app: AppHandle,
    input: ApplyInstallTicketInput,
) -> Result<ApplyInstallTicketResponse, String> {
    let manifest = fetch_manifest(&input).await?;
    ensure_supported_manifest(&manifest)?;

    let registry_path = local_registry_path(&app);
    let apply_result =
        native_execute_rollback(&manifest, &registry_path, &input.trace_id, |event| {
            emit_progress_event(&app, event)
        })?;

    for stage in [
        "ticket_issued",
        "downloading",
        "staging",
        "verifying",
        "committing",
    ] {
        let consume_response = consume_stage(&input, &manifest, stage).await?;
        if consume_response.next_action == "abort" {
            return Err("backend asked rollback flow to abort".to_string());
        }
    }

    report_final(
        &input,
        manifest.install_record_id,
        &apply_result.final_status,
        Some(apply_result.resolved_target_path.clone()),
        apply_result.managed_file_hashes.clone(),
    )
    .await?;

    Ok(ApplyInstallTicketResponse {
        ticket_id: manifest.ticket_id,
        install_record_id: manifest.install_record_id,
        final_status: apply_result.final_status,
        resolved_target_path: apply_result.resolved_target_path,
        managed_file_hashes: apply_result.managed_file_hashes,
        local_registry_path: apply_result.local_registry_path,
    })
}

#[tauri::command]
fn verify_installation(
    app: AppHandle,
    input: InstallationDetailInput,
) -> Result<LocalInstallationVerification, String> {
    native_verify_installation(&local_registry_path(&app), input.install_record_id)
}

#[tauri::command]
fn get_installation_detail(
    app: AppHandle,
    input: InstallationDetailInput,
) -> Result<Option<LocalInstallationDetail>, String> {
    let registry = LocalInstallRegistry::open(&local_registry_path(&app))?;
    registry.get_installation_detail(input.install_record_id)
}

#[tauri::command]
fn list_local_installs(app: AppHandle) -> Result<Vec<LocalInstallRecord>, String> {
    let registry = LocalInstallRegistry::open(&local_registry_path(&app))?;
    registry.list_installs()
}

fn emit_progress_event(app: &AppHandle, event: InstallProgressEvent) {
    let _ = app.emit(INSTALL_PROGRESS_EVENT, event);
}

async fn fetch_manifest(input: &ApplyInstallTicketInput) -> Result<InstallManifest, String> {
    let response = reqwest::Client::new()
        .get(format!(
            "{}/api/native/install-tickets/{}/manifest",
            trim_api_base_url(&input.api_base_url),
            input.ticket_id
        ))
        .header("authorization", format!("Bearer {}", input.auth_token))
        .header("x-device-token", &input.device_token)
        .send()
        .await
        .map_err(http_error)?;

    if !response.status().is_success() {
        return Err(format!(
            "manifest request failed with {}",
            response.status()
        ));
    }

    response.json::<InstallManifest>().await.map_err(http_error)
}

async fn fetch_install_package(
    manifest: &InstallManifest,
) -> Result<InstallPackageDocument, String> {
    let package_bytes = load_package_bytes(&manifest.package.uri).await?;
    verify_package_checksum(&package_bytes, &manifest.package.checksum)?;
    parse_install_package(&package_bytes)
}

async fn load_package_bytes(uri: &str) -> Result<Vec<u8>, String> {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        let response = reqwest::Client::new()
            .get(uri)
            .send()
            .await
            .map_err(http_error)?;
        if !response.status().is_success() {
            return Err(format!("package request failed with {}", response.status()));
        }
        return response
            .bytes()
            .await
            .map(|value| value.to_vec())
            .map_err(http_error);
    }

    if let Some(value) = uri.strip_prefix("file://") {
        return std::fs::read(decode_file_uri_path(value)).map_err(io_error);
    }

    if let Some(value) = uri.strip_prefix("data:") {
        return decode_data_uri(value);
    }

    std::fs::read(PathBuf::from(uri)).map_err(io_error)
}

async fn consume_stage(
    input: &ApplyInstallTicketInput,
    manifest: &InstallManifest,
    stage: &str,
) -> Result<ConsumeInstallTicketResponse, String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/native/install-tickets/{}/consume",
            trim_api_base_url(&input.api_base_url),
            input.ticket_id
        ))
        .header("authorization", format!("Bearer {}", input.auth_token))
        .header("x-device-token", &input.device_token)
        .json(&ConsumeInstallTicketRequest {
            install_record_id: manifest.install_record_id,
            stage: stage.to_string(),
            result: "ok".to_string(),
            trace_id: input.trace_id.clone(),
            retry_token: manifest.retry_token.clone(),
        })
        .send()
        .await
        .map_err(http_error)?;

    if !response.status().is_success() {
        return Err(format!(
            "consume request for {stage} failed with {}",
            response.status()
        ));
    }

    response
        .json::<ConsumeInstallTicketResponse>()
        .await
        .map_err(http_error)
}

async fn report_final(
    input: &ApplyInstallTicketInput,
    install_record_id: i64,
    final_status: &str,
    resolved_target_path: Option<String>,
    managed_file_hashes: Vec<String>,
) -> Result<(), String> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/native/install-operations/{}/report",
            trim_api_base_url(&input.api_base_url),
            install_record_id
        ))
        .header("authorization", format!("Bearer {}", input.auth_token))
        .header("x-device-token", &input.device_token)
        .json(&ReportInstallOperationRequest {
            final_status: final_status.to_string(),
            resolved_target_path,
            managed_file_hashes,
            trace_id: input.trace_id.clone(),
        })
        .send()
        .await
        .map_err(http_error)?;

    if !response.status().is_success() {
        return Err(format!("final report failed with {}", response.status()));
    }

    Ok(())
}

fn ensure_supported_manifest(manifest: &InstallManifest) -> Result<(), String> {
    let workspace_root = manifest.variables.get("workspaceRoot");
    if workspace_root.is_none() {
        return Err("apply_install_ticket currently requires project scope".to_string());
    }

    match manifest.template.template_code.as_str() {
        "cursor_project_rule" | "opencode_project_skill" => Ok(()),
        unsupported => Err(format!(
            "apply_install_ticket currently only supports verified Cursor/OpenCode project templates, got {}",
            unsupported
        )),
    }
}

fn local_registry_path(app: &AppHandle) -> PathBuf {
    let base_dir = app
        .path()
        .app_local_data_dir()
        .ok()
        .unwrap_or_else(|| env::temp_dir().join("prime-skill-pro"));
    base_dir.join("local-install-registry.sqlite")
}

fn default_workspace_path() -> String {
    env::current_dir()
        .ok()
        .map(|path| normalize_path(&path))
        .unwrap_or_else(|| "G:/train/PrimeSkill-Pro".to_string())
}

fn default_device_token() -> String {
    "device-token-001".to_string()
}

fn trim_api_base_url(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}

fn project_fingerprint(workspace_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    workspace_path.hash(&mut hasher);
    format!("fp-{:x}", hasher.finish())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn http_error(error: reqwest::Error) -> String {
    error.to_string()
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

fn decode_file_uri_path(value: &str) -> PathBuf {
    let trimmed = value.trim_start_matches('/');
    if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
        PathBuf::from(trimmed)
    } else {
        PathBuf::from(value)
    }
}

fn decode_data_uri(value: &str) -> Result<Vec<u8>, String> {
    let (metadata, payload) = value
        .split_once(',')
        .ok_or_else(|| "invalid data uri".to_string())?;
    if metadata.ends_with(";base64") {
        return BASE64.decode(payload).map_err(|error| error.to_string());
    }
    Ok(payload.as_bytes().to_vec())
}
