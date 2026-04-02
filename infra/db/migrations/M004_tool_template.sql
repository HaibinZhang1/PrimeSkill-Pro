BEGIN;

CREATE TABLE IF NOT EXISTS ai_tool_catalog (
  id BIGSERIAL PRIMARY KEY,
  tool_code VARCHAR(64) NOT NULL UNIQUE,
  tool_name VARCHAR(128) NOT NULL,
  vendor VARCHAR(128),
  tool_family VARCHAR(64),
  supported_os_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  official_doc_url TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'experimental')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS ai_tool_install_target_template (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES ai_tool_catalog(id),
  template_code VARCHAR(128) NOT NULL,
  template_revision INT NOT NULL,
  os_type VARCHAR(32) NOT NULL,
  artifact_type VARCHAR(32) NOT NULL,
  scope_type VARCHAR(32) NOT NULL CHECK (scope_type IN ('global', 'project')),
  template_name VARCHAR(128) NOT NULL,
  target_path_template TEXT NOT NULL,
  filename_template TEXT,
  packaging_mode VARCHAR(32) NOT NULL CHECK (packaging_mode IN ('single_file', 'directory', 'merge', 'append')),
  content_management_mode VARCHAR(32) NOT NULL DEFAULT 'replace' CHECK (content_management_mode IN ('replace', 'managed_block')),
  managed_block_marker VARCHAR(256),
  path_variables_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_tool_version VARCHAR(64),
  max_tool_version VARCHAR(64),
  priority INT NOT NULL DEFAULT 100,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  release_status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (release_status IN ('active', 'retired', 'draft')),
  supersedes_template_id BIGINT REFERENCES ai_tool_install_target_template(id),
  verification_status VARCHAR(32) NOT NULL DEFAULT 'candidate' CHECK (verification_status IN ('verified', 'candidate', 'deprecated')),
  source_reference_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT,
  UNIQUE(tool_id, template_code, template_revision, os_type)
);

CREATE TABLE IF NOT EXISTS ai_tool_detection_rule (
  id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES ai_tool_catalog(id),
  os_type VARCHAR(32) NOT NULL,
  detection_type VARCHAR(32) NOT NULL CHECK (detection_type IN ('path_exists', 'registry', 'process', 'config_file')),
  rule_expr TEXT NOT NULL,
  expected_install_path TEXT,
  expected_config_path TEXT,
  expected_target_path TEXT,
  priority INT NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE INDEX IF NOT EXISTS idx_template_verify
  ON ai_tool_install_target_template(verification_status, release_status, os_type);

CREATE INDEX IF NOT EXISTS idx_detection_tool_os
  ON ai_tool_detection_rule(tool_id, os_type, is_active);

COMMIT;
