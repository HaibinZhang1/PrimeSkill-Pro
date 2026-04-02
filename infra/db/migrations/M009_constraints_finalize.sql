BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_install_record_idempotency
  ON install_record(source_client_id, operation_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_binding_active_path
  ON local_install_binding(client_device_id, resolved_target_path)
  WHERE state='active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_template_default_active
  ON ai_tool_install_target_template(tool_id, os_type, scope_type, artifact_type)
  WHERE is_default = TRUE AND release_status = 'active';

COMMIT;
