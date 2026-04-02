# ADR 0003: Path Governance by Template Tables

## Status
Accepted

## Decision
Path governance is driven only by:
- `ai_tool_catalog`
- `ai_tool_install_target_template`
- `ai_tool_detection_rule`

No unified `.agentskills` primary path is allowed.
`candidate` templates are visible but not default-recommended.

## Consequences
- Tool-specific compatibility is preserved.
- Template revisions become auditable and immutable.
- Windows verification gates promotion to `verified`.
