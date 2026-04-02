BEGIN;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES "user"(id),
  action VARCHAR(128) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip INET,
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_tool_catalog (tool_code, tool_name, vendor, tool_family, supported_os_json, official_doc_url, status)
VALUES
  ('cursor', 'Cursor', 'Cursor', 'editor-agent', '["windows","macos"]', 'https://docs.cursor.com', 'active'),
  ('cline', 'Cline', 'Cline', 'editor-agent', '["windows","macos"]', 'https://docs.cline.bot', 'active'),
  ('opencode', 'OpenCode', 'SST', 'agent-cli', '["windows","macos","linux"]', 'https://opencode.ai/docs/skills', 'active'),
  ('codex', 'Codex', 'OpenAI', 'agent-cli', '["windows","macos","linux"]', 'https://openai.com/introducing-codex/', 'active')
ON CONFLICT (tool_code) DO UPDATE
SET tool_name = EXCLUDED.tool_name,
    vendor = EXCLUDED.vendor,
    tool_family = EXCLUDED.tool_family,
    supported_os_json = EXCLUDED.supported_os_json,
    official_doc_url = EXCLUDED.official_doc_url,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'cursor_project_rule', 1, 'windows', 'rule', 'project', 'cursor_project_rule',
       '${workspaceRoot}/.cursor/rules', '${skillKey}.mdc', 'single_file', 'replace',
       NULL, '["workspaceRoot","skillKey"]'::jsonb, 10, TRUE, 'active', 'verified',
       'https://docs.cursor.com/context/rules'
FROM ai_tool_catalog WHERE tool_code = 'cursor'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'cline_project_skill', 1, 'windows', 'skill', 'project', 'cline_project_skill',
       '${workspaceRoot}/.cline/skills/${skillKey}', 'SKILL.md', 'directory', 'replace',
       NULL, '["workspaceRoot","skillKey"]'::jsonb, 20, FALSE, 'active', 'candidate',
       'https://docs.cline.bot/'
FROM ai_tool_catalog WHERE tool_code = 'cline'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'cline_project_rules', 1, 'windows', 'instruction', 'project', 'cline_project_rules',
       '${workspaceRoot}', '.clinerules', 'append', 'managed_block',
       'PRIME_SKILL', '["workspaceRoot"]'::jsonb, 30, FALSE, 'active', 'candidate',
       'https://docs.cline.bot/'
FROM ai_tool_catalog WHERE tool_code = 'cline'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'opencode_project_skill', 1, 'windows', 'skill', 'project', 'opencode_project_skill',
       '${workspaceRoot}/.opencode/skills/${skillKey}', 'SKILL.md', 'directory', 'replace',
       NULL, '["workspaceRoot","skillKey"]'::jsonb, 10, TRUE, 'active', 'verified',
       'https://opencode.ai/docs/skills'
FROM ai_tool_catalog WHERE tool_code = 'opencode'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'opencode_global_skill', 1, 'windows', 'skill', 'global', 'opencode_global_skill',
       '${userHome}/.config/opencode/skills/${skillKey}', 'SKILL.md', 'directory', 'replace',
       NULL, '["userHome","skillKey"]'::jsonb, 40, FALSE, 'active', 'candidate',
       'https://opencode.ai/docs/skills'
FROM ai_tool_catalog WHERE tool_code = 'opencode'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

INSERT INTO ai_tool_install_target_template
  (tool_id, template_code, template_revision, os_type, artifact_type, scope_type, template_name,
   target_path_template, filename_template, packaging_mode, content_management_mode,
   managed_block_marker, path_variables_json, priority, is_default, release_status,
   verification_status, source_reference_url)
SELECT id, 'codex_project_agents_md', 1, 'windows', 'agents_md', 'project', 'codex_project_agents_md',
       '${workspaceRoot}', 'AGENTS.md', 'append', 'managed_block',
       'PRIME_SKILL', '["workspaceRoot"]'::jsonb, 50, FALSE, 'active', 'candidate',
       'https://openai.com/introducing-codex/'
FROM ai_tool_catalog WHERE tool_code = 'codex'
ON CONFLICT (tool_id, template_code, template_revision, os_type) DO NOTHING;

COMMIT;
