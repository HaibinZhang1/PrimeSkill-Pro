# ADR 0002: Dual-Lock Policy for Install Operations

## Status
Accepted

## Decision
Lock with two layers:
1. Redis distributed lock (fast reject, TTL=120s, renew)
2. PostgreSQL advisory lock (transaction-level final exclusion)

Lock key source: `sha256(client_device_id + ':' + resolved_target_path)`.

## Consequences
- Prevents concurrent writes to same target path.
- Keeps lock semantics consistent across backend and native reporting.
