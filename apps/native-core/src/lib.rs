use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const IPC_NAMESPACE: &str = "tauri://prime-skill";
pub const DEFAULT_MANAGED_BLOCK_MARKER: &str = "PRIME_SKILL";
pub const INSTALL_PROGRESS_EVENT: &str = "prime-skill://install-progress";

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
    pub resolved_target_path: String,
    pub installed_at: String,
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

pub fn resolve_template_value(template: &str, variables: &BTreeMap<String, String>) -> Result<String, String> {
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
    let target_directory = resolve_template_value(&manifest.template.target_path_template, &manifest.variables)?;
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
        _ => return Err(format!("unsupported tool preview: {tool_code}/{scope_type}")),
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

pub fn execute_install<F>(
    manifest: &InstallManifest,
    registry_path: &Path,
    trace_id: &str,
    mut emit_progress: F,
) -> Result<ApplyInstallResult, String>
where
    F: FnMut(InstallProgressEvent),
{
    emit_progress(progress_event(manifest, trace_id, InstallStage::TicketIssued));
    emit_progress(progress_event(manifest, trace_id, InstallStage::Downloading));

    let resolved = resolve_install_target(manifest)?;
    emit_progress(progress_event(manifest, trace_id, InstallStage::Staging));
    apply_manifest_skeleton(manifest, &resolved)?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Verifying));
    let file_hash = hash_file(&resolved.file_path)?;

    emit_progress(progress_event(manifest, trace_id, InstallStage::Committing));
    let registry = LocalInstallRegistry::open(registry_path)?;
    registry.record_install(LocalInstallRecord {
        install_record_id: manifest.install_record_id,
        ticket_id: manifest.ticket_id.clone(),
        skill_key: manifest
            .variables
            .get("skillKey")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        template_code: manifest.template.template_code.clone(),
        resolved_target_path: resolved.resolved_target_path.clone(),
        installed_at: now_iso_string(),
    })?;

    Ok(ApplyInstallResult {
        resolved_target_path: resolved.resolved_target_path,
        managed_file_hashes: vec![file_hash],
        backup_snapshot_path: None,
        local_registry_path: normalize_path(registry_path),
        final_status: InstallFinalStatus::Success.as_str().to_string(),
    })
}

pub fn apply_manifest_skeleton(
    manifest: &InstallManifest,
    resolved: &ResolvedInstallTarget,
) -> Result<(), String> {
    let skill_key = manifest
        .variables
        .get("skillKey")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());

    match manifest.template.template_code.as_str() {
        "cursor_project_rule" => {
            fs::create_dir_all(&resolved.target_directory).map_err(io_error)?;
            fs::write(&resolved.file_path, build_cursor_rule_body(&skill_key, &manifest.package.uri))
                .map_err(io_error)?;
            Ok(())
        }
        "opencode_project_skill" => {
            fs::create_dir_all(&resolved.target_directory).map_err(io_error)?;
            fs::write(
                &resolved.file_path,
                build_opencode_skill_body(&skill_key, &manifest.package.uri),
            )
            .map_err(io_error)?;
            Ok(())
        }
        template_code if manifest.template.content_management_mode == "managed_block" => {
            let marker = ManagedBlockMarker {
                marker_name: manifest
                    .template
                    .managed_block_marker
                    .clone()
                    .unwrap_or_else(|| DEFAULT_MANAGED_BLOCK_MARKER.to_string()),
                skill_key,
            };
            let existing = fs::read_to_string(&resolved.file_path).unwrap_or_default();
            let updated = upsert_managed_block(&existing, &marker, &build_managed_block_body(template_code));
            if let Some(parent) = resolved.file_path.parent() {
                fs::create_dir_all(parent).map_err(io_error)?;
            }
            fs::write(&resolved.file_path, updated).map_err(io_error)?;
            Ok(())
        }
        _ => Err(format!(
            "unsupported install template for this round: {}",
            manifest.template.template_code
        )),
    }
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

    pub fn record_install(&self, record: LocalInstallRecord) -> Result<(), String> {
        let connection = Connection::open(&self.path).map_err(sqlite_error)?;
        initialize_registry_schema(&connection)?;
        connection
            .execute(
                r#"
                INSERT INTO local_install_registry (
                  install_record_id,
                  ticket_id,
                  skill_key,
                  template_code,
                  resolved_target_path,
                  installed_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(install_record_id) DO UPDATE
                SET ticket_id = excluded.ticket_id,
                    skill_key = excluded.skill_key,
                    template_code = excluded.template_code,
                    resolved_target_path = excluded.resolved_target_path,
                    installed_at = excluded.installed_at
                "#,
                params![
                    record.install_record_id,
                    record.ticket_id,
                    record.skill_key,
                    record.template_code,
                    record.resolved_target_path,
                    record.installed_at
                ],
            )
            .map_err(sqlite_error)?;
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
                  resolved_target_path,
                  installed_at
                FROM local_install_registry
                ORDER BY install_record_id DESC
                "#,
            )
            .map_err(sqlite_error)?;

        let rows = statement
            .query_map([], |row| {
                Ok(LocalInstallRecord {
                    install_record_id: row.get(0)?,
                    ticket_id: row.get(1)?,
                    skill_key: row.get(2)?,
                    template_code: row.get(3)?,
                    resolved_target_path: row.get(4)?,
                    installed_at: row.get(5)?,
                })
            })
            .map_err(sqlite_error)?;

        let mut installs = Vec::new();
        for row in rows {
            installs.push(row.map_err(sqlite_error)?);
        }
        Ok(installs)
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
            "#,
        )
        .map_err(sqlite_error)
}

fn build_cursor_rule_body(skill_key: &str, package_uri: &str) -> String {
    format!(
        "# {skill_key}\n\nInstalled by PrimeSkill Pro.\n\nSource package: {package_uri}\n"
    )
}

fn build_opencode_skill_body(skill_key: &str, package_uri: &str) -> String {
    format!(
        "# {skill_key}\n\nThis project skill was applied by PrimeSkill Pro.\n\nSource package: {package_uri}\n"
    )
}

fn build_managed_block_body(template_code: &str) -> String {
    format!("Managed block applied by PrimeSkill Pro for {template_code}.")
}

fn progress_event(manifest: &InstallManifest, trace_id: &str, stage: InstallStage) -> InstallProgressEvent {
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
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn io_error(error: std::io::Error) -> String {
    error.to_string()
}

fn sqlite_error(error: rusqlite::Error) -> String {
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

    fn sample_manifest(template_code: &str, target_template: &str, filename_template: Option<&str>) -> InstallManifest {
        let mut variables = BTreeMap::new();
        variables.insert("workspaceRoot".to_string(), "D:/repo/demo".to_string());
        variables.insert("skillKey".to_string(), "api-contract".to_string());

        InstallManifest {
            ticket_id: "tk_test".to_string(),
            install_record_id: 42,
            package: InstallManifestPackage {
                uri: "https://example.test/skill.zip".to_string(),
                checksum: "sha256:test".to_string(),
                signature: None,
            },
            template: InstallManifestTemplate {
                template_id: 1,
                template_code: template_code.to_string(),
                template_revision: 1,
                target_path_template: target_template.to_string(),
                filename_template: filename_template.map(|value| value.to_string()),
                packaging_mode: "single_file".to_string(),
                content_management_mode: "replace".to_string(),
                managed_block_marker: None,
            },
            variables,
            verify_rules: vec!["checksum".to_string()],
            retry_token: None,
        }
    }

    #[test]
    fn resolves_project_cursor_rule_path() {
        let manifest = sample_manifest(
            "cursor_project_rule",
            "${workspaceRoot}/.cursor/rules",
            Some("${skillKey}.mdc"),
        );

        let resolved = resolve_install_target(&manifest).expect("target should resolve");

        assert_eq!(resolved.resolved_target_path, "D:/repo/demo/.cursor/rules/api-contract.mdc");
        assert_eq!(resolved.resolved_filename.as_deref(), Some("api-contract.mdc"));
    }

    #[test]
    fn resolves_opencode_skill_path() {
        let manifest = sample_manifest(
            "opencode_project_skill",
            "${workspaceRoot}/.opencode/skills/${skillKey}",
            Some("SKILL.md"),
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
    fn writes_install_and_lists_registry_records() {
        let temp = tempdir().expect("tempdir");
        let registry_path = temp.path().join("registry.sqlite");
        let manifest = sample_manifest(
            "cursor_project_rule",
            temp.path().join(".cursor/rules").to_string_lossy().as_ref(),
            Some("${skillKey}.mdc"),
        );

        let result = execute_install(&manifest, &registry_path, "trace-1", |_| {})
            .expect("install should succeed");
        assert_eq!(result.final_status, "success");

        let registry = LocalInstallRegistry::open(&registry_path).expect("registry");
        let installs = registry.list_installs().expect("list installs");
        assert_eq!(installs.len(), 1);
        assert_eq!(installs[0].install_record_id, 42);
        assert!(installs[0].resolved_target_path.contains("api-contract.mdc"));
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
