use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

pub const IPC_NAMESPACE: &str = "tauri://prime-skill";
pub const DEFAULT_MANAGED_BLOCK_MARKER: &str = "PRIME_SKILL";
pub const INSTALL_PROGRESS_EVENT: &str = "prime-skill://install-progress";
pub const INSTALL_PACKAGE_FORMAT_V1: &str = "prime_skill_package.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStage {
    TicketIssued,
    Downloading,
    Staging,
    Verifying,
    Committing,
}

impl InstallStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TicketIssued => "ticket_issued",
            Self::Downloading => "downloading",
            Self::Staging => "staging",
            Self::Verifying => "verifying",
            Self::Committing => "committing",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallFinalStatus {
    Success,
    Failed,
    RolledBack,
    Cancelled,
}

impl InstallFinalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failed => "failed",
            Self::RolledBack => "rolled_back",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedBlockMarker {
    pub marker_name: String,
    pub skill_key: String,
}

impl ManagedBlockMarker {
    pub fn begin(&self) -> String {
        format!("BEGIN {}:{}", self.marker_name, self.skill_key)
    }

    pub fn end(&self) -> String {
        format!("END {}:{}", self.marker_name, self.skill_key)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifestPackage {
    pub uri: String,
    pub checksum: String,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifestTemplate {
    pub template_id: i64,
    pub template_code: String,
    pub template_revision: i32,
    pub target_path_template: String,
    pub filename_template: Option<String>,
    pub packaging_mode: String,
    pub content_management_mode: String,
    pub managed_block_marker: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifest {
    pub ticket_id: String,
    pub install_record_id: i64,
    pub package: InstallManifestPackage,
    pub template: InstallManifestTemplate,
    pub variables: BTreeMap<String, String>,
    pub verify_rules: Vec<String>,
    pub retry_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageDocument {
    pub format: String,
    pub entries: Vec<InstallPackageEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallPackageEntry {
    pub path: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub content_base64: Option<String>,
    #[serde(default)]
    pub media_type: Option<String>,
}

impl InstallPackageEntry {
    fn decode_bytes(&self) -> Result<Vec<u8>, String> {
        match (&self.content, &self.content_base64) {
            (Some(content), None) => Ok(content.as_bytes().to_vec()),
            (None, Some(content_base64)) => BASE64
                .decode(content_base64)
                .map_err(|error| format!("invalid base64 package entry {}: {}", self.path, error)),
            (Some(_), Some(_)) => Err(format!(
                "package entry {} cannot define both content and contentBase64",
                self.path
            )),
            (None, None) => Err(format!(
                "package entry {} must define content or contentBase64",
                self.path
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInstallTarget {
    pub tool_code: String,
    pub scope_type: String,
    pub template_code: String,
    pub resolved_target_path: String,
    pub resolved_filename: Option<String>,
    pub packaging_mode: String,
    pub verification_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgressEvent {
    pub install_record_id: i64,
    pub ticket_id: String,
    pub trace_id: String,
    pub stage: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyInstallResult {
    pub resolved_target_path: String,
    pub managed_file_hashes: Vec<String>,
    pub backup_snapshot_path: Option<String>,
    pub local_registry_path: String,
    pub final_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallRecord {
    pub install_record_id: i64,
    pub ticket_id: String,
    pub skill_key: String,
    pub template_code: String,
    pub content_management_mode: String,
    pub package_uri: String,
    pub resolved_target_path: String,
    pub target_root_path: String,
    pub installed_at: String,
    pub removed_at: Option<String>,
    pub final_status: String,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallFileRecord {
    pub install_record_id: i64,
    pub file_path: String,
    pub relative_path: String,
    pub target_root_path: String,
    pub content_management_mode: String,
    pub existed_before: bool,
    pub sha256_before: Option<String>,
    pub sha256_after: Option<String>,
    pub managed_block_begin: Option<String>,
    pub managed_block_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallationDetail {
    pub install: LocalInstallRecord,
    pub files: Vec<LocalInstallFileRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallationVerification {
    pub install_record_id: i64,
    pub resolved_target_path: String,
    pub verification_status: String,
    pub verified_at: String,
    pub drift_reasons: Vec<String>,
    pub files: Vec<LocalInstallationVerificationFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstallationVerificationFile {
    pub install_record_id: i64,
    pub file_path: String,
    pub relative_path: String,
    pub content_management_mode: String,
    pub exists: bool,
    pub expected_sha256: Option<String>,
    pub current_sha256: Option<String>,
    pub hash_matches: bool,
    pub managed_block_present: Option<bool>,
    pub status: String,
    pub drift_reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeBootstrapStatus {
    pub namespace: String,
    pub managed_block_begin: String,
    pub managed_block_end: String,
    pub sample_target_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedInstallTarget {
    pub target_directory: PathBuf,
    pub file_path: PathBuf,
    pub resolved_target_path: String,
    pub resolved_filename: Option<String>,
}

#[derive(Debug, Clone)]
struct FileMutationPlan {
    file_path: PathBuf,
    relative_path: String,
    target_root_path: PathBuf,
    content_management_mode: String,
    original_exists: bool,
    original_bytes: Option<Vec<u8>>,
    rendered_bytes: Vec<u8>,
    managed_block_begin: Option<String>,
    managed_block_end: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredFileState {
    file_path: String,
    relative_path: String,
    target_root_path: String,
    content_management_mode: String,
    original_exists: bool,
    original_content_base64: Option<String>,
    sha256_before: Option<String>,
    sha256_after: Option<String>,
    managed_block_begin: Option<String>,
    managed_block_end: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredInstallationState {
    install: LocalInstallRecord,
    files: Vec<StoredFileState>,
}

pub fn resolve_template_value(
    template: &str,
    variables: &BTreeMap<String, String>,
) -> Result<String, String> {
    let mut rendered = template.to_string();
    for (key, value) in variables {
        rendered = rendered.replace(&format!("${{{}}}", key), value);
    }

    if rendered.contains("${") {
        return Err(format!("unresolved template variable in {}", template));
    }

    Ok(rendered)
}

pub fn resolve_install_target(manifest: &InstallManifest) -> Result<ResolvedInstallTarget, String> {
    let target_directory =
        resolve_template_value(&manifest.template.target_path_template, &manifest.variables)?;
    let resolved_filename = manifest
        .template
        .filename_template
        .as_ref()
        .map(|value| resolve_template_value(value, &manifest.variables))
        .transpose()?;

    let target_directory_path = PathBuf::from(target_directory);
    let file_path = match &resolved_filename {
        Some(filename) => target_directory_path.join(filename),
        None => target_directory_path.clone(),
    };

    Ok(ResolvedInstallTarget {
        target_directory: target_directory_path,
        file_path: file_path.clone(),
        resolved_target_path: normalize_path(&file_path),
        resolved_filename,
    })
}

pub fn preview_install_target(
    tool_code: &str,
    scope_type: &str,
    skill_key: &str,
    workspace_root: &str,
) -> Result<PreviewInstallTarget, String> {
    let template = match (tool_code, scope_type) {
        ("cursor", "project") => InstallManifestTemplate {
            template_id: 1,
            template_code: "cursor_project_rule".to_string(),
            template_revision: 1,
            target_path_template: "${workspaceRoot}/.cursor/rules".to_string(),
            filename_template: Some("${skillKey}.mdc".to_string()),
            packaging_mode: "single_file".to_string(),
            content_management_mode: "replace".to_string(),
            managed_block_marker: None,
        },
        ("opencode", "project") => InstallManifestTemplate {
            template_id: 2,
            template_code: "opencode_project_skill".to_string(),
            template_revision: 1,
            target_path_template: "${workspaceRoot}/.opencode/skills/${skillKey}".to_string(),
            filename_template: Some("SKILL.md".to_string()),
            packaging_mode: "directory".to_string(),
            content_management_mode: "replace".to_string(),
            managed_block_marker: None,
        },
        _ => {
            return Err(format!(
                "unsupported tool preview: {tool_code}/{scope_type}"
            ))
        }
    };

    let mut variables = BTreeMap::new();
    variables.insert("workspaceRoot".to_string(), workspace_root.to_string());
    variables.insert("skillKey".to_string(), skill_key.to_string());

    let manifest = InstallManifest {
        ticket_id: "preview".to_string(),
        install_record_id: 0,
        package: InstallManifestPackage {
            uri: "preview".to_string(),
            checksum: "preview".to_string(),
            signature: None,
        },
        template: template.clone(),
        variables,
        verify_rules: vec![],
        retry_token: None,
    };
    let resolved = resolve_install_target(&manifest)?;

    Ok(PreviewInstallTarget {
        tool_code: tool_code.to_string(),
        scope_type: scope_type.to_string(),
        template_code: template.template_code,
        resolved_target_path: resolved.resolved_target_path,
        resolved_filename: resolved.resolved_filename,
        packaging_mode: template.packaging_mode,
        verification_status: "verified".to_string(),
    })
}

pub fn upsert_managed_block(existing: &str, marker: &ManagedBlockMarker, body: &str) -> String {
    let begin = marker.begin();
    let end = marker.end();
    let wrapped = format!("{begin}\n{body}\n{end}");

    if let (Some(begin_index), Some(end_index)) = (existing.find(&begin), existing.find(&end)) {
        let suffix_start = end_index + end.len();
        let mut updated = String::new();
        updated.push_str(existing[..begin_index].trim_end());
        if !updated.is_empty() {
            updated.push_str("\n\n");
        }
        updated.push_str(&wrapped);

        let suffix = existing[suffix_start..].trim();
        if !suffix.is_empty() {
            updated.push_str("\n\n");
            updated.push_str(suffix);
        }
        return updated;
    }

    let mut updated = existing.trim().to_string();
    if !updated.is_empty() {
        updated.push_str("\n\n");
    }
    updated.push_str(&wrapped);
    updated
}

pub fn native_bootstrap_status() -> NativeBootstrapStatus {
    let marker = ManagedBlockMarker {
        marker_name: DEFAULT_MANAGED_BLOCK_MARKER.to_string(),
        skill_key: "bootstrap".to_string(),
    };
    let preview = preview_install_target("cursor", "project", "bootstrap", "D:/repo/demo")
        .expect("bootstrap preview should always resolve");

    NativeBootstrapStatus {
        namespace: IPC_NAMESPACE.to_string(),
        managed_block_begin: marker.begin(),
        managed_block_end: marker.end(),
        sample_target_path: preview.resolved_target_path,
    }
}

pub fn parse_install_package(bytes: &[u8]) -> Result<InstallPackageDocument, String> {
    if let Ok(document) = serde_json::from_slice::<InstallPackageDocument>(bytes) {
        validate_install_package(&document)?;
        return Ok(document);
    }

    parse_zip_install_package(bytes)
}

pub fn verify_package_checksum(bytes: &[u8], expected: &str) -> Result<(), String> {
    let trimmed = expected.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("preview") {
        return Ok(());
    }

    let digest = hash_bytes(bytes);
    if trimmed.eq_ignore_ascii_case(&digest) {
        return Ok(());
    }

    if let Some(rest) = trimmed.strip_prefix("sha256:") {
        if rest.len() != 64 {
            return Ok(());
        }
        if rest.eq_ignore_ascii_case(&digest) {
            return Ok(());
        }
        return Err("package checksum mismatch".to_string());
    }

    Ok(())
}

pub fn execute_install<F>(
    manifest: &InstallManifest,
    package: &InstallPackageDocument,
    registry_path: &Path,
    trace_id: &str,
    mut emit_progress: F,
) -> Result<ApplyInstallResult, String>
where
    F: FnMut(InstallProgressEvent),
{
    validate_install_package(package)?;
    emit_progress(progress_event(
        manifest,
        trace_id,
        InstallStage::TicketIssued,
    ));
    emit_progress(progress_event(
        manifest,
        trace_id,
        InstallStage::Downloading,
    ));

    let resolved = resolve_install_target(manifest)?;
    let plans = build_file_mutation_plans(manifest, &resolved, package)?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Staging));
    apply_file_plans(&plans)?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Verifying));
    let file_hashes = plans
        .iter()
        .map(|plan| hash_file(&plan.file_path))
        .collect::<Result<Vec<_>, _>>()?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Committing));
    let registry = LocalInstallRegistry::open(registry_path)?;
    registry.record_install(
        build_local_install_record(manifest, &resolved, plans.len()),
        &to_stored_file_states(&plans),
    )?;

    Ok(ApplyInstallResult {
        resolved_target_path: resolved.resolved_target_path,
        managed_file_hashes: file_hashes,
        backup_snapshot_path: None,
        local_registry_path: normalize_path(registry_path),
        final_status: InstallFinalStatus::Success.as_str().to_string(),
    })
}

pub fn execute_uninstall<F>(
    manifest: &InstallManifest,
    registry_path: &Path,
    trace_id: &str,
    emit_progress: F,
) -> Result<ApplyInstallResult, String>
where
    F: FnMut(InstallProgressEvent),
{
    execute_removal(
        manifest,
        registry_path,
        trace_id,
        InstallFinalStatus::Success,
        emit_progress,
    )
}

pub fn execute_rollback<F>(
    manifest: &InstallManifest,
    registry_path: &Path,
    trace_id: &str,
    emit_progress: F,
) -> Result<ApplyInstallResult, String>
where
    F: FnMut(InstallProgressEvent),
{
    execute_removal(
        manifest,
        registry_path,
        trace_id,
        InstallFinalStatus::RolledBack,
        emit_progress,
    )
}

fn execute_removal<F>(
    manifest: &InstallManifest,
    registry_path: &Path,
    trace_id: &str,
    final_status: InstallFinalStatus,
    mut emit_progress: F,
) -> Result<ApplyInstallResult, String>
where
    F: FnMut(InstallProgressEvent),
{
    emit_progress(progress_event(
        manifest,
        trace_id,
        InstallStage::TicketIssued,
    ));
    emit_progress(progress_event(
        manifest,
        trace_id,
        InstallStage::Downloading,
    ));

    let resolved = resolve_install_target(manifest)?;
    let registry = LocalInstallRegistry::open(registry_path)?;
    let state = registry
        .load_active_installation_by_resolved_target_path(&resolved.resolved_target_path)?
        .ok_or_else(|| {
            format!(
                "local installation not found for {}",
                resolved.resolved_target_path
            )
        })?;

    if resolved.resolved_target_path != state.install.resolved_target_path {
        return Err("manifest target does not match local installation".to_string());
    }
    if state.install.removed_at.is_some() {
        return Err("local installation already removed".to_string());
    }

    emit_progress(progress_event(manifest, trace_id, InstallStage::Staging));
    uninstall_file_states(&state.files)?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Verifying));
    emit_progress(progress_event(manifest, trace_id, InstallStage::Committing));

    let removed_at = now_iso_string();
    registry.mark_removed(state.install.install_record_id, &removed_at, final_status)?;

    Ok(ApplyInstallResult {
        resolved_target_path: state.install.resolved_target_path,
        managed_file_hashes: vec![],
        backup_snapshot_path: None,
        local_registry_path: normalize_path(registry_path),
        final_status: final_status.as_str().to_string(),
    })
}

pub fn verify_installation(
    registry_path: &Path,
    install_record_id: i64,
) -> Result<LocalInstallationVerification, String> {
    let registry = LocalInstallRegistry::open(registry_path)?;
    let state = registry
        .load_installation_state(install_record_id)?
        .ok_or_else(|| format!("local installation {} not found", install_record_id))?;

    if state.install.removed_at.is_some() {
        return Err("local installation already removed".to_string());
    }

    let verified_at = now_iso_string();
    let mut drift_reasons = BTreeSet::new();
    let mut files = Vec::new();

    for file in &state.files {
        let verified_file = verify_file_state(install_record_id, file)?;
        for reason in &verified_file.drift_reasons {
            drift_reasons.insert(reason.clone());
        }
        files.push(verified_file);
    }

    let verification_status = if drift_reasons.is_empty() {
        "verified"
    } else {
        "drifted"
    };

    Ok(LocalInstallationVerification {
        install_record_id,
        resolved_target_path: state.install.resolved_target_path,
        verification_status: verification_status.to_string(),
        verified_at,
        drift_reasons: drift_reasons.into_iter().collect(),
        files,
    })
}

pub struct LocalInstallRegistry {
    path: PathBuf,
}

impl LocalInstallRegistry {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let connection = Connection::open(path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    fn record_install(
        &self,
        record: LocalInstallRecord,
        files: &[StoredFileState],
    ) -> Result<(), String> {
        let mut connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;
        let transaction = connection.transaction().map_err(sqlite_error)?;

        transaction
            .execute(
                r#"
                INSERT INTO local_install_registry (
                  install_record_id,
                  ticket_id,
                  skill_key,
                  template_code,
                  content_management_mode,
                  package_uri,
                  resolved_target_path,
                  target_root_path,
                  installed_at,
                  removed_at,
                  final_status,
                  file_count
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                ON CONFLICT(install_record_id) DO UPDATE
                SET ticket_id = excluded.ticket_id,
                    skill_key = excluded.skill_key,
                    template_code = excluded.template_code,
                    content_management_mode = excluded.content_management_mode,
                    package_uri = excluded.package_uri,
                    resolved_target_path = excluded.resolved_target_path,
                    target_root_path = excluded.target_root_path,
                    installed_at = excluded.installed_at,
                    removed_at = excluded.removed_at,
                    final_status = excluded.final_status,
                    file_count = excluded.file_count
                "#,
                params![
                    record.install_record_id,
                    record.ticket_id,
                    record.skill_key,
                    record.template_code,
                    record.content_management_mode,
                    record.package_uri,
                    record.resolved_target_path,
                    record.target_root_path,
                    record.installed_at,
                    record.removed_at,
                    record.final_status,
                    record.file_count
                ],
            )
            .map_err(sqlite_error)?;

        transaction
            .execute(
                "DELETE FROM local_install_registry_file WHERE install_record_id = ?1",
                params![record.install_record_id],
            )
            .map_err(sqlite_error)?;

        for file in files {
            transaction
                .execute(
                    r#"
                    INSERT INTO local_install_registry_file (
                      install_record_id,
                      file_path,
                      relative_path,
                      target_root_path,
                      content_management_mode,
                      original_exists,
                      original_content_base64,
                      sha256_before,
                      sha256_after,
                      managed_block_begin,
                      managed_block_end
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                    "#,
                    params![
                        record.install_record_id,
                        file.file_path,
                        file.relative_path,
                        file.target_root_path,
                        file.content_management_mode,
                        bool_to_sqlite(file.original_exists),
                        file.original_content_base64,
                        file.sha256_before,
                        file.sha256_after,
                        file.managed_block_begin,
                        file.managed_block_end
                    ],
                )
                .map_err(sqlite_error)?;
        }

        transaction.commit().map_err(sqlite_error)?;
        Ok(())
    }

    pub fn list_installs(&self) -> Result<Vec<LocalInstallRecord>, String> {
        let connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;

        let mut statement = connection
            .prepare(
                r#"
                SELECT
                  install_record_id,
                  ticket_id,
                  skill_key,
                  template_code,
                  content_management_mode,
                  package_uri,
                  resolved_target_path,
                  target_root_path,
                  installed_at,
                  removed_at,
                  final_status,
                  file_count
                FROM local_install_registry
                ORDER BY install_record_id DESC
                "#,
            )
            .map_err(sqlite_error)?;

        let rows = statement
            .query_map([], map_install_row)
            .map_err(sqlite_error)?;

        let mut installs = Vec::new();
        for row in rows {
            installs.push(row.map_err(sqlite_error)?);
        }
        Ok(installs)
    }

    pub fn get_installation_detail(
        &self,
        install_record_id: i64,
    ) -> Result<Option<LocalInstallationDetail>, String> {
        let state = self.load_installation_state(install_record_id)?;
        Ok(state.map(|value| LocalInstallationDetail {
            install: value.install,
            files: value
                .files
                .into_iter()
                .map(|file| LocalInstallFileRecord {
                    install_record_id,
                    file_path: file.file_path,
                    relative_path: file.relative_path,
                    target_root_path: file.target_root_path,
                    content_management_mode: file.content_management_mode,
                    existed_before: file.original_exists,
                    sha256_before: file.sha256_before,
                    sha256_after: file.sha256_after,
                    managed_block_begin: file.managed_block_begin,
                    managed_block_end: file.managed_block_end,
                })
                .collect(),
        }))
    }

    pub fn mark_removed(
        &self,
        install_record_id: i64,
        removed_at: &str,
        final_status: InstallFinalStatus,
    ) -> Result<(), String> {
        let connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;
        connection
            .execute(
                r#"
                UPDATE local_install_registry
                SET removed_at = ?2,
                    final_status = ?3
                WHERE install_record_id = ?1
                "#,
                params![install_record_id, removed_at, final_status.as_str()],
            )
            .map_err(sqlite_error)?;
        Ok(())
    }

    fn load_installation_state(
        &self,
        install_record_id: i64,
    ) -> Result<Option<StoredInstallationState>, String> {
        let connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;

        let install = connection
            .query_row(
                r#"
                SELECT
                  install_record_id,
                  ticket_id,
                  skill_key,
                  template_code,
                  content_management_mode,
                  package_uri,
                  resolved_target_path,
                  target_root_path,
                  installed_at,
                  removed_at,
                  final_status,
                  file_count
                FROM local_install_registry
                WHERE install_record_id = ?1
                "#,
                params![install_record_id],
                map_install_row,
            )
            .optional()
            .map_err(sqlite_error)?;

        let Some(install) = install else {
            return Ok(None);
        };

        let mut statement = connection
            .prepare(
                r#"
                SELECT
                  file_path,
                  relative_path,
                  target_root_path,
                  content_management_mode,
                  original_exists,
                  original_content_base64,
                  sha256_before,
                  sha256_after,
                  managed_block_begin,
                  managed_block_end
                FROM local_install_registry_file
                WHERE install_record_id = ?1
                ORDER BY file_path ASC
                "#,
            )
            .map_err(sqlite_error)?;

        let rows = statement
            .query_map(params![install_record_id], |row| {
                Ok(StoredFileState {
                    file_path: row.get(0)?,
                    relative_path: row.get(1)?,
                    target_root_path: row.get(2)?,
                    content_management_mode: row.get(3)?,
                    original_exists: sqlite_to_bool(row.get::<_, i64>(4)?),
                    original_content_base64: row.get(5)?,
                    sha256_before: row.get(6)?,
                    sha256_after: row.get(7)?,
                    managed_block_begin: row.get(8)?,
                    managed_block_end: row.get(9)?,
                })
            })
            .map_err(sqlite_error)?;

        let mut files = Vec::new();
        for row in rows {
            files.push(row.map_err(sqlite_error)?);
        }

        Ok(Some(StoredInstallationState { install, files }))
    }

    fn load_active_installation_by_resolved_target_path(
        &self,
        resolved_target_path: &str,
    ) -> Result<Option<StoredInstallationState>, String> {
        let connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;

        let install_record_id = connection
            .query_row(
                r#"
                SELECT install_record_id
                FROM local_install_registry
                WHERE resolved_target_path = ?1
                  AND removed_at IS NULL
                ORDER BY install_record_id DESC
                LIMIT 1
                "#,
                params![resolved_target_path],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(sqlite_error)?;

        match install_record_id {
            Some(value) => self.load_installation_state(value),
            None => Ok(None),
        }
    }
}

fn build_local_install_record(
    manifest: &InstallManifest,
    resolved: &ResolvedInstallTarget,
    file_count: usize,
) -> LocalInstallRecord {
    LocalInstallRecord {
        install_record_id: manifest.install_record_id,
        ticket_id: manifest.ticket_id.clone(),
        skill_key: manifest
            .variables
            .get("skillKey")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        template_code: manifest.template.template_code.clone(),
        content_management_mode: manifest.template.content_management_mode.clone(),
        package_uri: manifest.package.uri.clone(),
        resolved_target_path: resolved.resolved_target_path.clone(),
        target_root_path: normalize_path(&resolved.target_directory),
        installed_at: now_iso_string(),
        removed_at: None,
        final_status: InstallFinalStatus::Success.as_str().to_string(),
        file_count: file_count as i64,
    }
}

fn to_stored_file_states(plans: &[FileMutationPlan]) -> Vec<StoredFileState> {
    plans
        .iter()
        .map(|plan| StoredFileState {
            file_path: normalize_path(&plan.file_path),
            relative_path: plan.relative_path.clone(),
            target_root_path: normalize_path(&plan.target_root_path),
            content_management_mode: plan.content_management_mode.clone(),
            original_exists: plan.original_exists,
            original_content_base64: plan
                .original_bytes
                .as_ref()
                .map(|bytes| BASE64.encode(bytes)),
            sha256_before: plan.original_bytes.as_ref().map(|bytes| hash_bytes(bytes)),
            sha256_after: Some(hash_bytes(&plan.rendered_bytes)),
            managed_block_begin: plan.managed_block_begin.clone(),
            managed_block_end: plan.managed_block_end.clone(),
        })
        .collect()
}

fn build_file_mutation_plans(
    manifest: &InstallManifest,
    resolved: &ResolvedInstallTarget,
    package: &InstallPackageDocument,
) -> Result<Vec<FileMutationPlan>, String> {
    match manifest.template.content_management_mode.as_str() {
        "replace" => build_replace_plans(manifest, resolved, package),
        "managed_block" => build_managed_block_plans(manifest, resolved, package),
        mode => Err(format!("unsupported content management mode: {}", mode)),
    }
}

fn build_replace_plans(
    manifest: &InstallManifest,
    resolved: &ResolvedInstallTarget,
    package: &InstallPackageDocument,
) -> Result<Vec<FileMutationPlan>, String> {
    match manifest.template.packaging_mode.as_str() {
        "single_file" => {
            if package.entries.len() != 1 {
                return Err("single_file package must contain exactly one entry".to_string());
            }
            let original_bytes = read_optional_bytes(&resolved.file_path)?;
            let entry = &package.entries[0];
            Ok(vec![FileMutationPlan {
                file_path: resolved.file_path.clone(),
                relative_path: normalize_relative_path(
                    resolved
                        .resolved_filename
                        .as_deref()
                        .unwrap_or(entry.path.as_str()),
                )?,
                target_root_path: resolved.target_directory.clone(),
                content_management_mode: manifest.template.content_management_mode.clone(),
                original_exists: original_bytes.is_some(),
                original_bytes,
                rendered_bytes: entry.decode_bytes()?,
                managed_block_begin: None,
                managed_block_end: None,
            }])
        }
        "directory" => {
            if package.entries.is_empty() {
                return Err("directory package must contain at least one entry".to_string());
            }

            let mut plans = Vec::new();
            for entry in &package.entries {
                let relative_path = normalize_relative_path(&entry.path)?;
                let file_path =
                    resolve_directory_entry_path(&resolved.target_directory, &relative_path)?;
                let original_bytes = read_optional_bytes(&file_path)?;
                plans.push(FileMutationPlan {
                    file_path,
                    relative_path,
                    target_root_path: resolved.target_directory.clone(),
                    content_management_mode: manifest.template.content_management_mode.clone(),
                    original_exists: original_bytes.is_some(),
                    original_bytes,
                    rendered_bytes: entry.decode_bytes()?,
                    managed_block_begin: None,
                    managed_block_end: None,
                });
            }
            Ok(plans)
        }
        mode => Err(format!("unsupported replace packaging mode: {}", mode)),
    }
}

fn build_managed_block_plans(
    manifest: &InstallManifest,
    resolved: &ResolvedInstallTarget,
    package: &InstallPackageDocument,
) -> Result<Vec<FileMutationPlan>, String> {
    if package.entries.len() != 1 {
        return Err("managed_block package must contain exactly one entry".to_string());
    }

    let marker = ManagedBlockMarker {
        marker_name: manifest
            .template
            .managed_block_marker
            .clone()
            .unwrap_or_else(|| DEFAULT_MANAGED_BLOCK_MARKER.to_string()),
        skill_key: manifest
            .variables
            .get("skillKey")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
    };

    let original_bytes = read_optional_bytes(&resolved.file_path)?;
    let existing = match original_bytes.as_ref() {
        Some(bytes) => String::from_utf8(bytes.clone())
            .map_err(|_| "managed_block only supports utf-8 text targets".to_string())?,
        None => String::new(),
    };
    let body_bytes = package.entries[0].decode_bytes()?;
    let body = String::from_utf8(body_bytes)
        .map_err(|_| "managed_block package content must be utf-8 text".to_string())?;
    let updated = upsert_managed_block(&existing, &marker, &body);

    Ok(vec![FileMutationPlan {
        file_path: resolved.file_path.clone(),
        relative_path: normalize_relative_path(
            resolved
                .resolved_filename
                .as_deref()
                .unwrap_or(package.entries[0].path.as_str()),
        )?,
        target_root_path: resolved.target_directory.clone(),
        content_management_mode: manifest.template.content_management_mode.clone(),
        original_exists: original_bytes.is_some(),
        original_bytes,
        rendered_bytes: updated.into_bytes(),
        managed_block_begin: Some(marker.begin()),
        managed_block_end: Some(marker.end()),
    }])
}

fn apply_file_plans(plans: &[FileMutationPlan]) -> Result<(), String> {
    let mut applied = Vec::new();
    for plan in plans {
        if let Err(error) = apply_single_plan(plan) {
            let rollback_error = rollback_applied_plans(&applied);
            return match rollback_error {
                Ok(()) => Err(error),
                Err(rollback) => Err(format!("{}; rollback failed: {}", error, rollback)),
            };
        }
        applied.push(plan.clone());
    }

    Ok(())
}

fn apply_single_plan(plan: &FileMutationPlan) -> Result<(), String> {
    if let Some(parent) = plan.file_path.parent() {
        fs::create_dir_all(parent).map_err(io_error)?;
    }
    fs::write(&plan.file_path, &plan.rendered_bytes).map_err(io_error)?;
    Ok(())
}

fn rollback_applied_plans(plans: &[FileMutationPlan]) -> Result<(), String> {
    for plan in plans.iter().rev() {
        restore_plan(plan)?;
    }
    Ok(())
}

fn restore_plan(plan: &FileMutationPlan) -> Result<(), String> {
    if plan.original_exists {
        if let Some(parent) = plan.file_path.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        fs::write(
            &plan.file_path,
            plan.original_bytes.as_deref().unwrap_or_default(),
        )
        .map_err(io_error)?;
    } else if plan.file_path.exists() {
        fs::remove_file(&plan.file_path).map_err(io_error)?;
        if let Some(parent) = plan.file_path.parent() {
            prune_empty_directories(parent, &plan.target_root_path)?;
        }
    }

    Ok(())
}

fn uninstall_file_states(files: &[StoredFileState]) -> Result<(), String> {
    for file in files.iter().rev() {
        let path = PathBuf::from(&file.file_path);
        if file.original_exists {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(io_error)?;
            }
            let original_bytes = file
                .original_content_base64
                .as_deref()
                .map(|value| BASE64.decode(value).map_err(|error| error.to_string()))
                .transpose()?
                .unwrap_or_default();
            fs::write(&path, original_bytes).map_err(io_error)?;
        } else if path.exists() {
            fs::remove_file(&path).map_err(io_error)?;
            if let Some(parent) = path.parent() {
                prune_empty_directories(parent, &PathBuf::from(&file.target_root_path))?;
            }
        }
    }

    Ok(())
}

fn verify_file_state(
    install_record_id: i64,
    file: &StoredFileState,
) -> Result<LocalInstallationVerificationFile, String> {
    let path = PathBuf::from(&file.file_path);
    let current_bytes = read_optional_bytes(&path)?;
    let exists = current_bytes.is_some();
    let current_sha256 = current_bytes.as_ref().map(|bytes| hash_bytes(bytes));
    let expected_sha256 = file.sha256_after.clone();
    let hash_matches = match (&expected_sha256, &current_sha256) {
        (Some(expected), Some(current)) => expected.eq_ignore_ascii_case(current),
        _ => false,
    };

    let mut drift_reasons = Vec::new();
    if !exists {
        drift_reasons.push("missing_file".to_string());
    }

    let managed_block_present = if file.content_management_mode == "managed_block" {
        let present = match (
            current_bytes.as_ref(),
            file.managed_block_begin.as_ref(),
            file.managed_block_end.as_ref(),
        ) {
            (Some(bytes), Some(begin), Some(end)) => {
                let text = String::from_utf8(bytes.clone())
                    .map_err(|_| "managed_block verification requires utf-8 text".to_string())?;
                match (text.find(begin), text.find(end)) {
                    (Some(begin_index), Some(end_index)) => begin_index < end_index,
                    _ => false,
                }
            }
            _ => false,
        };

        if !present {
            drift_reasons.push("managed_block_missing".to_string());
        }
        Some(present)
    } else {
        None
    };

    if exists && !hash_matches {
        drift_reasons.push("content_hash_mismatch".to_string());
    }

    let status = if drift_reasons.is_empty() {
        "verified"
    } else {
        "drifted"
    };

    Ok(LocalInstallationVerificationFile {
        install_record_id,
        file_path: file.file_path.clone(),
        relative_path: file.relative_path.clone(),
        content_management_mode: file.content_management_mode.clone(),
        exists,
        expected_sha256,
        current_sha256,
        hash_matches,
        managed_block_present,
        status: status.to_string(),
        drift_reasons,
    })
}

fn validate_install_package(package: &InstallPackageDocument) -> Result<(), String> {
    if package.format != INSTALL_PACKAGE_FORMAT_V1 {
        return Err(format!("unsupported package format: {}", package.format));
    }
    if package.entries.is_empty() {
        return Err("package must contain at least one entry".to_string());
    }
    for entry in &package.entries {
        normalize_relative_path(&entry.path)?;
        entry.decode_bytes()?;
    }
    Ok(())
}

fn parse_zip_install_package(bytes: &[u8]) -> Result<InstallPackageDocument, String> {
    let reader = Cursor::new(bytes);
    let mut archive = ZipArchive::new(reader).map_err(zip_error)?;
    let mut entries = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(zip_error)?;
        if file.is_dir() {
            continue;
        }

        let raw_path = file.name().replace('\\', "/");
        if should_skip_archive_entry(&raw_path) {
            continue;
        }

        let normalized_path = normalize_relative_path(&raw_path)?;
        let mut entry_bytes = Vec::new();
        file.read_to_end(&mut entry_bytes).map_err(io_error)?;

        entries.push(InstallPackageEntry {
            path: normalized_path.clone(),
            content: None,
            content_base64: Some(BASE64.encode(entry_bytes)),
            media_type: guess_media_type(&normalized_path),
        });
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));

    let document = InstallPackageDocument {
        format: INSTALL_PACKAGE_FORMAT_V1.to_string(),
        entries,
    };
    validate_install_package(&document)?;
    Ok(document)
}

fn should_skip_archive_entry(path: &str) -> bool {
    path.starts_with("__MACOSX/") || path.ends_with("/.DS_Store") || path == ".DS_Store"
}

fn guess_media_type(path: &str) -> Option<String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("md") | Some("mdc") => Some("text/markdown".to_string()),
        Some("txt") => Some("text/plain".to_string()),
        Some("json") => Some("application/json".to_string()),
        Some("yaml") | Some("yml") => Some("application/yaml".to_string()),
        Some("toml") => Some("application/toml".to_string()),
        _ => None,
    }
}

fn resolve_directory_entry_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for segment in relative_path.split('/') {
        path.push(segment);
    }
    Ok(path)
}

fn normalize_relative_path(value: &str) -> Result<String, String> {
    let candidate = value
        .replace('\\', "/")
        .trim()
        .trim_start_matches("./")
        .to_string();
    if candidate.is_empty() {
        return Err("package entry path cannot be empty".to_string());
    }
    if candidate.starts_with('/') {
        return Err(format!("package entry path must be relative: {}", value));
    }
    let parts = candidate.split('/').collect::<Vec<_>>();
    if parts
        .iter()
        .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err(format!("package entry path is invalid: {}", value));
    }
    Ok(parts.join("/"))
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}

fn initialize_registry_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_install_registry (
              install_record_id INTEGER PRIMARY KEY,
              ticket_id TEXT NOT NULL,
              skill_key TEXT NOT NULL,
              template_code TEXT NOT NULL,
              resolved_target_path TEXT NOT NULL,
              installed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_install_registry_file (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              install_record_id INTEGER NOT NULL,
              file_path TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              target_root_path TEXT NOT NULL,
              content_management_mode TEXT NOT NULL,
              original_exists INTEGER NOT NULL,
              original_content_base64 TEXT,
              sha256_before TEXT,
              sha256_after TEXT,
              managed_block_begin TEXT,
              managed_block_end TEXT
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_local_install_registry_file_unique
              ON local_install_registry_file(install_record_id, file_path);
            "#,
        )
        .map_err(sqlite_error)?;

    ensure_sqlite_column(
        connection,
        "local_install_registry",
        "content_management_mode",
        "TEXT NOT NULL DEFAULT 'replace'",
    )?;
    ensure_sqlite_column(
        connection,
        "local_install_registry",
        "package_uri",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_sqlite_column(
        connection,
        "local_install_registry",
        "target_root_path",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    ensure_sqlite_column(connection, "local_install_registry", "removed_at", "TEXT")?;
    ensure_sqlite_column(
        connection,
        "local_install_registry",
        "final_status",
        "TEXT NOT NULL DEFAULT 'success'",
    )?;
    ensure_sqlite_column(
        connection,
        "local_install_registry",
        "file_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;

    Ok(())
}

fn ensure_sqlite_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(sqlite_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sqlite_error)?;

    for existing in columns {
        if existing.map_err(sqlite_error)? == column {
            return Ok(());
        }
    }

    connection
        .execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition),
            [],
        )
        .map_err(sqlite_error)?;
    Ok(())
}

fn map_install_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalInstallRecord> {
    Ok(LocalInstallRecord {
        install_record_id: row.get(0)?,
        ticket_id: row.get(1)?,
        skill_key: row.get(2)?,
        template_code: row.get(3)?,
        content_management_mode: row.get(4)?,
        package_uri: row.get(5)?,
        resolved_target_path: row.get(6)?,
        target_root_path: row.get(7)?,
        installed_at: row.get(8)?,
        removed_at: row.get(9)?,
        final_status: row.get(10)?,
        file_count: row.get(11)?,
    })
}

fn prune_empty_directories(start: &Path, stop: &Path) -> Result<(), String> {
    let mut current = start.to_path_buf();
    loop {
        if !current.exists() {
            if current == stop {
                break;
            }
        } else if fs::read_dir(&current).map_err(io_error)?.next().is_some() {
            break;
        } else {
            fs::remove_dir(&current).map_err(io_error)?;
        }

        if current == stop {
            break;
        }

        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }

    Ok(())
}

fn progress_event(
    manifest: &InstallManifest,
    trace_id: &str,
    stage: InstallStage,
) -> InstallProgressEvent {
    InstallProgressEvent {
        install_record_id: manifest.install_record_id,
        ticket_id: manifest.ticket_id.clone(),
        trace_id: trace_id.to_string(),
        stage: stage.as_str().to_string(),
        timestamp: now_iso_string(),
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(io_error)?;
    Ok(hash_bytes(&bytes))
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn bool_to_sqlite(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn sqlite_to_bool(value: i64) -> bool {
    value != 0
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

fn sqlite_error(error: rusqlite::Error) -> String {
    error.to_string()
}

fn zip_error(error: zip::result::ZipError) -> String {
    error.to_string()
}

fn now_iso_string() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    timestamp.to_string()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use zip::{write::SimpleFileOptions, ZipWriter};

    use std::io::Write;

    fn sample_manifest(
        template_code: &str,
        target_template: &str,
        filename_template: Option<&str>,
        packaging_mode: &str,
        content_management_mode: &str,
    ) -> InstallManifest {
        let mut variables = BTreeMap::new();
        variables.insert("workspaceRoot".to_string(), "D:/repo/demo".to_string());
        variables.insert("skillKey".to_string(), "api-contract".to_string());

        InstallManifest {
            ticket_id: "tk_test".to_string(),
            install_record_id: 42,
            package: InstallManifestPackage {
                uri: "file:///tmp/api-contract.package.json".to_string(),
                checksum: "sha256:test".to_string(),
                signature: None,
            },
            template: InstallManifestTemplate {
                template_id: 1,
                template_code: template_code.to_string(),
                template_revision: 1,
                target_path_template: target_template.to_string(),
                filename_template: filename_template.map(|value| value.to_string()),
                packaging_mode: packaging_mode.to_string(),
                content_management_mode: content_management_mode.to_string(),
                managed_block_marker: Some(DEFAULT_MANAGED_BLOCK_MARKER.to_string()),
            },
            variables,
            verify_rules: vec!["checksum".to_string()],
            retry_token: None,
        }
    }

    fn package_with_entries(entries: Vec<(&str, &str)>) -> InstallPackageDocument {
        InstallPackageDocument {
            format: INSTALL_PACKAGE_FORMAT_V1.to_string(),
            entries: entries
                .into_iter()
                .map(|(path, content)| InstallPackageEntry {
                    path: path.to_string(),
                    content: Some(content.to_string()),
                    content_base64: None,
                    media_type: Some("text/plain".to_string()),
                })
                .collect(),
        }
    }

    fn zip_bytes_with_entries(entries: Vec<(&str, &[u8])>) -> Vec<u8> {
        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default();
            for (path, content) in entries {
                writer.start_file(path, options).expect("start zip file");
                writer.write_all(content).expect("write zip entry");
            }
            writer.finish().expect("finish zip");
        }
        cursor.into_inner()
    }

    #[test]
    fn resolves_project_cursor_rule_path() {
        let manifest = sample_manifest(
            "cursor_project_rule",
            "${workspaceRoot}/.cursor/rules",
            Some("${skillKey}.mdc"),
            "single_file",
            "replace",
        );

        let resolved = resolve_install_target(&manifest).expect("target should resolve");

        assert_eq!(
            resolved.resolved_target_path,
            "D:/repo/demo/.cursor/rules/api-contract.mdc"
        );
        assert_eq!(
            resolved.resolved_filename.as_deref(),
            Some("api-contract.mdc")
        );
    }

    #[test]
    fn resolves_opencode_skill_path() {
        let manifest = sample_manifest(
            "opencode_project_skill",
            "${workspaceRoot}/.opencode/skills/${skillKey}",
            Some("SKILL.md"),
            "directory",
            "replace",
        );

        let resolved = resolve_install_target(&manifest).expect("target should resolve");

        assert_eq!(
            resolved.resolved_target_path,
            "D:/repo/demo/.opencode/skills/api-contract/SKILL.md"
        );
        assert_eq!(resolved.resolved_filename.as_deref(), Some("SKILL.md"));
    }

    #[test]
    fn inserts_managed_block_when_missing() {
        let marker = ManagedBlockMarker {
            marker_name: DEFAULT_MANAGED_BLOCK_MARKER.to_string(),
            skill_key: "api-contract".to_string(),
        };

        let updated = upsert_managed_block("Existing header", &marker, "Injected body");

        assert!(updated.contains("Existing header"));
        assert!(updated.contains("BEGIN PRIME_SKILL:api-contract"));
        assert!(updated.contains("Injected body"));
        assert!(updated.contains("END PRIME_SKILL:api-contract"));
    }

    #[test]
    fn replaces_existing_managed_block_in_place() {
        let marker = ManagedBlockMarker {
            marker_name: DEFAULT_MANAGED_BLOCK_MARKER.to_string(),
            skill_key: "api-contract".to_string(),
        };
        let existing = "Intro\n\nBEGIN PRIME_SKILL:api-contract\nOld body\nEND PRIME_SKILL:api-contract\n\nFooter";

        let updated = upsert_managed_block(existing, &marker, "New body");

        assert!(!updated.contains("Old body"));
        assert!(updated.contains("New body"));
        assert!(updated.starts_with("Intro"));
        assert!(updated.ends_with("Footer"));
    }

    #[test]
    fn parses_package_document() {
        let bytes = br##"{"format":"prime_skill_package.v1","entries":[{"path":"SKILL.md","content":"# test"}]}"##;

        let package = parse_install_package(bytes).expect("package should parse");

        assert_eq!(package.entries.len(), 1);
        assert_eq!(package.entries[0].path, "SKILL.md");
    }

    #[test]
    fn parses_zip_package_document() {
        let bytes = zip_bytes_with_entries(vec![
            ("SKILL.md", b"# API Contract\n"),
            ("prompts/review.md", b"Check the contract.\n"),
        ]);

        let package = parse_install_package(&bytes).expect("zip package should parse");

        assert_eq!(package.entries.len(), 2);
        assert_eq!(package.entries[0].path, "SKILL.md");
        assert_eq!(package.entries[1].path, "prompts/review.md");
        assert_eq!(
            package.entries[0].media_type.as_deref(),
            Some("text/markdown")
        );
    }

    #[test]
    fn rejects_zip_package_with_path_traversal() {
        let bytes = zip_bytes_with_entries(vec![("../escape.txt", b"nope")]);

        let error = parse_install_package(&bytes).expect_err("zip should be rejected");

        assert!(error.contains("package entry path is invalid"));
    }

    #[test]
    fn writes_real_content_and_records_file_metadata() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "cursor_project_rule",
            temp.path().join(".cursor/rules").to_string_lossy().as_ref(),
            Some("${skillKey}.mdc"),
            "single_file",
            "replace",
        );
        let package =
            package_with_entries(vec![("rule.mdc", "# API Contract\n\nUse JSON schemas.")]);

        let result = execute_install(&manifest, &package, &registry_path, "trace-1", |_| {})
            .expect("install should succeed");
        assert_eq!(result.final_status, "success");

        let target_path = temp.path().join(".cursor/rules/api-contract.mdc");
        let target_content = fs::read_to_string(&target_path).expect("target content");
        assert_eq!(target_content, "# API Contract\n\nUse JSON schemas.");

        let registry = LocalInstallRegistry::open(&registry_path).expect("registry");
        let detail = registry
            .get_installation_detail(42)
            .expect("detail")
            .expect("detail present");
        assert_eq!(detail.install.file_count, 1);
        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].relative_path, "api-contract.mdc");
        assert_eq!(detail.files[0].content_management_mode, "replace");
        assert!(!detail.files[0].existed_before);
        assert!(detail.files[0].sha256_after.is_some());
    }

    #[test]
    fn uninstall_restores_managed_block_target() {
        let temp = tempdir().expect("tempdir");
        let workspace_root = temp.path().to_string_lossy().to_string();
        let registry_path = temp.path().join("registry.sqlite");
        let target_path = temp.path().join(".clinerules");
        fs::write(&target_path, "Intro\n\nFooter").expect("seed target");

        let mut manifest = sample_manifest(
            "cline_project_rules",
            "${workspaceRoot}",
            Some(".clinerules"),
            "append",
            "managed_block",
        );
        manifest
            .variables
            .insert("workspaceRoot".to_string(), workspace_root.clone());

        let package = package_with_entries(vec![("memory.md", "Remember the API boundary.")]);
        execute_install(&manifest, &package, &registry_path, "trace-2", |_| {})
            .expect("managed block install");

        let installed = fs::read_to_string(&target_path).expect("installed");
        assert!(installed.contains("BEGIN PRIME_SKILL:api-contract"));
        assert!(installed.contains("Remember the API boundary."));

        execute_uninstall(&manifest, &registry_path, "trace-3", |_| {}).expect("uninstall");

        let restored = fs::read_to_string(&target_path).expect("restored");
        assert_eq!(restored, "Intro\n\nFooter");

        let registry = LocalInstallRegistry::open(&registry_path).expect("registry");
        let detail = registry
            .get_installation_detail(42)
            .expect("detail")
            .expect("detail present");
        assert!(detail.install.removed_at.is_some());
        assert_eq!(
            detail.files[0].managed_block_begin.as_deref(),
            Some("BEGIN PRIME_SKILL:api-contract")
        );
    }

    #[test]
    fn directory_install_uninstall_removes_created_files() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "opencode_project_skill",
            temp.path()
                .join(".opencode/skills/${skillKey}")
                .to_string_lossy()
                .as_ref(),
            Some("SKILL.md"),
            "directory",
            "replace",
        );
        let package = package_with_entries(vec![
            ("SKILL.md", "# Skill"),
            ("prompts/review.md", "Check the contract."),
        ]);

        execute_install(&manifest, &package, &registry_path, "trace-4", |_| {}).expect("install");

        let skill_dir = temp.path().join(".opencode/skills/api-contract");
        assert!(skill_dir.join("SKILL.md").exists());
        assert!(skill_dir.join("prompts/review.md").exists());

        execute_uninstall(&manifest, &registry_path, "trace-5", |_| {}).expect("uninstall");

        assert!(!skill_dir.join("SKILL.md").exists());
        assert!(!skill_dir.join("prompts/review.md").exists());
    }

    #[test]
    fn rollback_restores_previous_content_and_marks_registry() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "cursor_project_rule",
            temp.path().join(".cursor/rules").to_string_lossy().as_ref(),
            Some("${skillKey}.mdc"),
            "single_file",
            "replace",
        );
        let target_path = temp.path().join(".cursor/rules/api-contract.mdc");
        std::fs::create_dir_all(target_path.parent().expect("target parent"))
            .expect("create parent");
        fs::write(&target_path, "previous content").expect("seed target");

        let package =
            package_with_entries(vec![("rule.mdc", "# API Contract\n\nUse JSON schemas.")]);

        execute_install(&manifest, &package, &registry_path, "trace-6", |_| {}).expect("install");
        let mut rollback_manifest = manifest.clone();
        rollback_manifest.install_record_id = 99;
        execute_rollback(&rollback_manifest, &registry_path, "trace-7", |_| {}).expect("rollback");

        let restored = fs::read_to_string(&target_path).expect("restored");
        assert_eq!(restored, "previous content");

        let registry = LocalInstallRegistry::open(&registry_path).expect("registry");
        let detail = registry
            .get_installation_detail(42)
            .expect("detail")
            .expect("detail present");
        assert!(detail.install.removed_at.is_some());
        assert_eq!(detail.install.final_status, "rolled_back");
    }

    #[test]
    fn verify_installation_reports_verified_for_intact_replace_target() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "cursor_project_rule",
            temp.path().join(".cursor/rules").to_string_lossy().as_ref(),
            Some("${skillKey}.mdc"),
            "single_file",
            "replace",
        );
        let package =
            package_with_entries(vec![("rule.mdc", "# API Contract\n\nUse JSON schemas.")]);

        execute_install(&manifest, &package, &registry_path, "trace-8", |_| {})
            .expect("install should succeed");

        let verification =
            verify_installation(&registry_path, 42).expect("verify should succeed");

        assert_eq!(verification.verification_status, "verified");
        assert!(verification.drift_reasons.is_empty());
        assert_eq!(verification.files.len(), 1);
        assert!(verification.files[0].exists);
        assert!(verification.files[0].hash_matches);
        assert_eq!(verification.files[0].status, "verified");
    }

    #[test]
    fn verify_installation_reports_hash_drift_for_modified_replace_target() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "cursor_project_rule",
            temp.path().join(".cursor/rules").to_string_lossy().as_ref(),
            Some("${skillKey}.mdc"),
            "single_file",
            "replace",
        );
        let target_path = temp.path().join(".cursor/rules/api-contract.mdc");
        let package =
            package_with_entries(vec![("rule.mdc", "# API Contract\n\nUse JSON schemas.")]);

        execute_install(&manifest, &package, &registry_path, "trace-9", |_| {})
            .expect("install should succeed");
        fs::write(&target_path, "# API Contract\n\nUse XML instead.").expect("mutate target");

        let verification =
            verify_installation(&registry_path, 42).expect("verify should succeed");

        assert_eq!(verification.verification_status, "drifted");
        assert!(verification
            .drift_reasons
            .contains(&"content_hash_mismatch".to_string()));
        assert_eq!(verification.files[0].status, "drifted");
        assert!(!verification.files[0].hash_matches);
    }

    #[test]
    fn verify_installation_reports_managed_block_drift_when_markers_are_missing() {
        let temp = tempdir().expect("tempdir");
        let workspace_root = temp.path().to_string_lossy().to_string();
        let registry_path = temp.path().join("registry.sqlite");
        let target_path = temp.path().join(".clinerules");
        fs::write(&target_path, "Intro\n\nFooter").expect("seed target");

        let mut manifest = sample_manifest(
            "cline_project_rules",
            "${workspaceRoot}",
            Some(".clinerules"),
            "append",
            "managed_block",
        );
        manifest
            .variables
            .insert("workspaceRoot".to_string(), workspace_root.clone());

        let package = package_with_entries(vec![("memory.md", "Remember the API boundary.")]);
        execute_install(&manifest, &package, &registry_path, "trace-10", |_| {})
            .expect("managed block install");

        fs::write(&target_path, "Intro\n\nFooter").expect("remove managed block");

        let verification =
            verify_installation(&registry_path, 42).expect("verify should succeed");

        assert_eq!(verification.verification_status, "drifted");
        assert!(verification
            .drift_reasons
            .contains(&"managed_block_missing".to_string()));
        assert_eq!(verification.files[0].managed_block_present, Some(false));
        assert_eq!(verification.files[0].status, "drifted");
    }

    #[test]
    fn builds_native_bootstrap_status_snapshot() {
        let status = native_bootstrap_status();

        assert_eq!(status.namespace, IPC_NAMESPACE);
        assert_eq!(status.managed_block_begin, "BEGIN PRIME_SKILL:bootstrap");
        assert_eq!(status.managed_block_end, "END PRIME_SKILL:bootstrap");
        assert_eq!(
            status.sample_target_path,
            "D:/repo/demo/.cursor/rules/bootstrap.mdc"
        );
    }
}
