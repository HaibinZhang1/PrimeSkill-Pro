# Database Migrations

Apply in strict order:
1. M001_extensions.sql
2. M002_iam_org.sql
3. M003_skill_review.sql
4. M004_tool_template.sql
5. M005_device_workspace.sql
6. M006_install_governance.sql
7. M007_search_indexes.sql
8. M008_audit_seed.sql
9. M009_constraints_finalize.sql

## Notes
- Requires PostgreSQL 16+ with pgvector extension.
- HNSW indexes are used for stage1/stage2 vectors.
- `M009` enforces partial unique indexes for idempotency and active bindings.
