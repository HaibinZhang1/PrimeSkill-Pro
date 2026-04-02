BEGIN;

CREATE TABLE IF NOT EXISTS skill_category (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  parent_id BIGINT REFERENCES skill_category(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS skill_tag (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS skill (
  id BIGSERIAL PRIMARY KEY,
  skill_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  summary TEXT,
  description TEXT,
  owner_user_id BIGINT NOT NULL REFERENCES "user"(id),
  owner_department_id BIGINT REFERENCES department(id),
  category_id BIGINT REFERENCES skill_category(id),
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'rejected', 'archived')),
  visibility_type VARCHAR(32) NOT NULL DEFAULT 'department' CHECK (visibility_type IN ('public', 'department', 'private')),
  current_version_id BIGINT,
  average_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  favorite_count INT NOT NULL DEFAULT 0,
  install_count INT NOT NULL DEFAULT 0,
  invoke_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS skill_version (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  version VARCHAR(64) NOT NULL,
  package_uri TEXT NOT NULL,
  manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  readme_text TEXT,
  changelog TEXT,
  ai_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  install_mode_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum VARCHAR(256) NOT NULL,
  signature TEXT,
  review_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  stage1_index_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (stage1_index_status IN ('pending', 'processing', 'ready', 'failed')),
  stage2_index_status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (stage2_index_status IN ('pending', 'processing', 'ready', 'failed')),
  search_ready_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL REFERENCES "user"(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT,
  UNIQUE (skill_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_skill_current_version'
  ) THEN
    ALTER TABLE skill
      ADD CONSTRAINT fk_skill_current_version
      FOREIGN KEY (current_version_id) REFERENCES skill_version(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS skill_tag_rel (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  tag_id BIGINT NOT NULL REFERENCES skill_tag(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  UNIQUE (skill_id, tag_id)
);

CREATE TABLE IF NOT EXISTS skill_permission_rule (
  id BIGSERIAL PRIMARY KEY,
  skill_id BIGINT NOT NULL REFERENCES skill(id),
  rule_type VARCHAR(32) NOT NULL CHECK (rule_type IN ('view', 'use', 'manage')),
  subject_type VARCHAR(32) NOT NULL CHECK (subject_type IN ('all', 'department', 'user', 'role')),
  subject_ref_id BIGINT,
  effect VARCHAR(16) NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS review_task (
  id BIGSERIAL PRIMARY KEY,
  skill_version_id BIGINT NOT NULL REFERENCES skill_version(id),
  submitter_id BIGINT NOT NULL REFERENCES "user"(id),
  reviewer_id BIGINT REFERENCES "user"(id),
  review_round INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'assigned', 'in_review', 'approved', 'rejected', 'closed')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT,
  CHECK (submitter_id <> reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_owner ON skill(owner_user_id, owner_department_id);
CREATE INDEX IF NOT EXISTS idx_skill_status_visibility ON skill(status, visibility_type);
CREATE INDEX IF NOT EXISTS idx_skill_version_status ON skill_version(stage1_index_status, stage2_index_status);
CREATE INDEX IF NOT EXISTS idx_skill_permission_rule_subject ON skill_permission_rule(subject_type, subject_ref_id);
CREATE INDEX IF NOT EXISTS idx_review_task_status ON review_task(status, reviewer_id);

COMMIT;
