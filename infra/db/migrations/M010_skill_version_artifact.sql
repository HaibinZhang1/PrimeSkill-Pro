BEGIN;

CREATE TABLE IF NOT EXISTS skill_version_artifact (
  id BIGSERIAL PRIMARY KEY,
  skill_version_id BIGINT NOT NULL UNIQUE REFERENCES skill_version(id) ON DELETE CASCADE,
  artifact_key VARCHAR(64) NOT NULL UNIQUE,
  storage_kind VARCHAR(32) NOT NULL DEFAULT 'database_inline' CHECK (storage_kind IN ('database_inline')),
  package_format VARCHAR(32) NOT NULL CHECK (package_format IN ('zip', 'legacy_json')),
  mime_type VARCHAR(128) NOT NULL,
  file_name VARCHAR(256) NOT NULL,
  sha256 VARCHAR(128) NOT NULL,
  byte_size INT NOT NULL CHECK (byte_size >= 0),
  entry_count INT NOT NULL CHECK (entry_count >= 0),
  package_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT REFERENCES "user"(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE INDEX IF NOT EXISTS idx_skill_version_artifact_format
  ON skill_version_artifact(package_format);

COMMIT;
