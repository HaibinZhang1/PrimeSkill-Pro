#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStage {
    TicketIssued,
    Downloading,
    Staging,
    Verifying,
    Committing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallFinalStatus {
    Success,
    Failed,
    RolledBack,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedBlockMarker {
    pub skill_key: String,
}

impl ManagedBlockMarker {
    pub fn begin(&self) -> String {
        format!("BEGIN PRIME_SKILL:{}", self.skill_key)
    }

    pub fn end(&self) -> String {
        format!("END PRIME_SKILL:{}", self.skill_key)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallTarget {
    pub workspace_root: Option<String>,
    pub user_home: Option<String>,
    pub target_path_template: String,
    pub filename_template: Option<String>,
    pub skill_key: String,
}

impl InstallTarget {
    pub fn resolve_target_path(&self) -> String {
        let mut path = self.target_path_template.clone();
        if let Some(workspace_root) = &self.workspace_root {
            path = path.replace("${workspaceRoot}", workspace_root);
        }
        if let Some(user_home) = &self.user_home {
            path = path.replace("${userHome}", user_home);
        }
        path = path.replace("${skillKey}", &self.skill_key);
        if let Some(filename) = &self.filename_template {
            format!("{}/{}", path.trim_end_matches('/'), filename.replace("${skillKey}", &self.skill_key))
        } else {
            path
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeBootstrapStatus {
    pub namespace: String,
    pub managed_block_begin: String,
    pub managed_block_end: String,
    pub sample_target_path: String,
}

pub fn native_bootstrap_status() -> NativeBootstrapStatus {
    let marker = ManagedBlockMarker {
        skill_key: "bootstrap".to_string(),
    };
    let target = InstallTarget {
        workspace_root: Some("D:/repo/demo".to_string()),
        user_home: Some("C:/Users/demo".to_string()),
        target_path_template: "${workspaceRoot}/.cursor/rules".to_string(),
        filename_template: Some("${skillKey}.mdc".to_string()),
        skill_key: "bootstrap".to_string(),
    };

    NativeBootstrapStatus {
        namespace: "tauri://prime-skill".to_string(),
        managed_block_begin: marker.begin(),
        managed_block_end: marker.end(),
        sample_target_path: target.resolve_target_path(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_project_cursor_rule_path() {
        let target = InstallTarget {
            workspace_root: Some("D:/repo/demo".to_string()),
            user_home: None,
            target_path_template: "${workspaceRoot}/.cursor/rules".to_string(),
            filename_template: Some("${skillKey}.mdc".to_string()),
            skill_key: "api-contract".to_string(),
        };

        assert_eq!(
            target.resolve_target_path(),
            "D:/repo/demo/.cursor/rules/api-contract.mdc"
        );
    }

    #[test]
    fn builds_native_bootstrap_status_snapshot() {
        let status = native_bootstrap_status();

        assert_eq!(status.namespace, "tauri://prime-skill");
        assert_eq!(status.managed_block_begin, "BEGIN PRIME_SKILL:bootstrap");
        assert_eq!(status.managed_block_end, "END PRIME_SKILL:bootstrap");
        assert_eq!(
            status.sample_target_path,
            "D:/repo/demo/.cursor/rules/bootstrap.mdc"
        );
    }
}
