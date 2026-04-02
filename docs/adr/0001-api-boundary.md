# ADR 0001: API Boundary Split (admin / desktop / native / internal)

## Status
Accepted

## Decision
Adopt four explicit namespaces:
- `/api/admin/*`
- `/api/desktop/*`
- `/api/native/*`
- `/api/internal/*`

Native-only install execution endpoints are never exposed to desktop UI routes.

## Consequences
- Removes desktop/native boundary ambiguity.
- Enables dedicated auth policy per namespace.
- Reduces risk of local privilege escalation.
