BEGIN;

CREATE TABLE IF NOT EXISTS client_device (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  device_fingerprint VARCHAR(128) NOT NULL UNIQUE,
  device_name VARCHAR(128) NOT NULL,
  os_type VARCHAR(32) NOT NULL,
  os_version VARCHAR(64),
  desktop_app_version VARCHAR(64),
  native_core_version VARCHAR(64),
  last_seen_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS tool_instance (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  client_device_id BIGINT NOT NULL REFERENCES client_device(id),
  tool_id BIGINT NOT NULL REFERENCES ai_tool_catalog(id),
  tool_version VARCHAR(64),
  os_type VARCHAR(32) NOT NULL,
  detected_install_path TEXT,
  detected_config_path TEXT,
  discovered_targets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  detection_source VARCHAR(32) NOT NULL DEFAULT 'auto' CHECK (detection_source IN ('auto', 'manual', 'imported')),
  trust_status VARCHAR(32) NOT NULL DEFAULT 'detected' CHECK (trust_status IN ('detected', 'verified', 'disabled')),
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS workspace_registry (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  client_device_id BIGINT NOT NULL REFERENCES client_device(id),
  workspace_name VARCHAR(256),
  workspace_path TEXT NOT NULL,
  repo_remote TEXT,
  repo_branch VARCHAR(128),
  project_fingerprint VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  last_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT,
  UNIQUE (client_device_id, project_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_tool_instance_user_device ON tool_instance(user_id, client_device_id);
CREATE INDEX IF NOT EXISTS idx_workspace_registry_fingerprint ON workspace_registry(project_fingerprint);

COMMIT;
