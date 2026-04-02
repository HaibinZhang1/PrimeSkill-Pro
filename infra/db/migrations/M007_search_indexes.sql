BEGIN;

CREATE TABLE IF NOT EXISTS skill_search_profile (
  id BIGSERIAL PRIMARY KEY,
  skill_version_id BIGINT NOT NULL UNIQUE REFERENCES skill_version(id),
  title_text TEXT NOT NULL,
  summary_text TEXT,
  tag_text TEXT,
  category_text TEXT,
  supported_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  keyword_document TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  head_embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT
);

CREATE TABLE IF NOT EXISTS skill_document (
  id BIGSERIAL PRIMARY KEY,
  skill_version_id BIGINT NOT NULL REFERENCES skill_version(id),
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT,
  UNIQUE (skill_version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_skill_search_profile_keyword_document
  ON skill_search_profile USING GIN (keyword_document gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_skill_search_profile_head_embedding
  ON skill_search_profile USING hnsw (head_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_doc_version
  ON skill_document(skill_version_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_skill_document_embedding
  ON skill_document USING hnsw (embedding vector_cosine_ops);

COMMIT;
