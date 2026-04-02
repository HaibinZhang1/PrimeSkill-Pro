BEGIN;

CREATE TABLE IF NOT EXISTS install_record (
  id BIGSERIAL PRIMARY KEY,
  operation_type VARCHAR(32) NOT NULL CHECK (operation_type IN ('install', 'upgrade', 'uninstall', 'rollback')),
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  skill_version_id BIGINT REFERENCES skill_version(id),
  previous_skill_version_id BIGINT REFERENCES skill_version(id),
  target_scope VARCHAR(32) NOT NULL CHECK (target_scope IN ('global', 'project')),
  tool_instance_id BIGINT REFERENCES tool_instance(id),
  install_target_template_id BIGINT REFERENCES ai_tool_install_target_template(id),
  workspace_registry_id BIGINT REFERENCES workspace_registry(id),
  resolved_target_path TEXT,
  lock_key VARCHAR(256),
  idempotency_key VARCHAR(128),
  manifest_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  install_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (
    install_status IN (
      'pending',
      'ticket_issued',
      'downloading',
      'staging',
      'verifying',
      'committing',
      'success',
      'failed',
      'rolling_back',
      'rolled_back',
      'cancelled'
    )
  ),
  status_version INT NOT NULL DEFAULT 0,
  operation_seq BIGINT NOT NULL DEFAULT 1,
  source_client_id BIGINT REFERENCES client_device(id),
  source_ip INET,
  error_code VARCHAR(64),
  error_message TEXT,
  trace_id VARCHAR(128),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS install_ticket (
  id BIGSERIAL PRIMARY KEY,
  ticket_id VARCHAR(128) NOT NULL UNIQUE,
  install_record_id BIGINT NOT NULL REFERENCES install_record(id),
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  client_device_id BIGINT NOT NULL REFERENCES client_device(id),
  tool_instance_id BIGINT REFERENCES tool_instance(id),
  workspace_registry_id BIGINT REFERENCES workspace_registry(id),
  install_target_template_id BIGINT REFERENCES ai_tool_install_target_template(id),
  ticket_scope VARCHAR(32) NOT NULL CHECK (ticket_scope IN ('install', 'upgrade', 'uninstall', 'rollback', 'verify')),
  status VARCHAR(32) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed', 'expired', 'cancelled')),
  consume_mode VARCHAR(32) NOT NULL DEFAULT 'one_time' CHECK (consume_mode IN ('one_time', 'idempotent_retry')),
  retry_token VARCHAR(128),
  manifest_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(128),
  trace_id VARCHAR(128),
  source_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS local_install_binding (
  id BIGSERIAL PRIMARY KEY,
  client_device_id BIGINT NOT NULL REFERENCES client_device(id),
  tool_instance_id BIGINT REFERENCES tool_instance(id),
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  skill_version_id BIGINT REFERENCES skill_version(id),
  install_record_id BIGINT NOT NULL REFERENCES install_record(id),
  target_scope VARCHAR(32) NOT NULL CHECK (target_scope IN ('global', 'project')),
  workspace_registry_id BIGINT REFERENCES workspace_registry(id),
  install_target_template_id BIGINT REFERENCES ai_tool_install_target_template(id),
  resolved_target_path TEXT NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'removed', 'drifted')),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS skill_usage_event (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES "user"(id),
  client_device_id BIGINT REFERENCES client_device(id),
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  skill_version_id BIGINT REFERENCES skill_version(id),
  tool_instance_id BIGINT REFERENCES tool_instance(id),
  workspace_registry_id BIGINT REFERENCES workspace_registry(id),
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('install', 'upgrade', 'uninstall', 'rollback', 'invoke', 'verify')),
  event_source VARCHAR(32) NOT NULL CHECK (event_source IN ('desktop_ui', 'native_core', 'worker')),
  event_time TIMESTAMPTZ NOT NULL,
  dedupe_key VARCHAR(128),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT
);

CREATE INDEX IF NOT EXISTS idx_install_record_lock_key ON install_record(lock_key);
CREATE INDEX IF NOT EXISTS idx_install_record_user_created ON install_record(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_install_record_trace ON install_record(trace_id);
CREATE INDEX IF NOT EXISTS idx_install_ticket_record_status ON install_ticket(install_record_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_user_device ON install_ticket(user_id, client_device_id);
CREATE INDEX IF NOT EXISTS idx_binding_skill_device ON local_install_binding(skill_id, client_device_id, state);
CREATE INDEX IF NOT EXISTS idx_binding_workspace ON local_install_binding(workspace_registry_id, state);
CREATE INDEX IF NOT EXISTS idx_usage_event_skill_time ON skill_usage_event(skill_id, event_time DESC);

COMMIT;
