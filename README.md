# PrimeSkill Pro

PrimeSkill Pro is an internal Agent Skills marketplace for desktop-first discovery and governed local installation.

## Workspace layout

- `apps/backend`: NestJS backend and install ticket APIs
- `apps/desktop-ui`: React desktop UI plus Tauri host
- `apps/native-core`: Rust native install/runtime core
- `apps/search-worker`: indexing and search worker skeleton
- `apps/admin-web`: admin portal skeleton
- `infra/db/migrations`: PostgreSQL schema migrations

## This round

This repo now includes the first project-scope install loop for verified templates:

- Desktop UI syncs `client_device`, `tool_instance`, and `workspace_registry`
- Backend issues install tickets with the existing install service
- Native Core applies verified project templates for:
  - Cursor project rules
  - OpenCode project skills
- Backend records `local_install_binding`
- Desktop UI reads `GET /api/my/installs` to render “My installs”

The current apply path is intentionally limited:

- project scope only
- verified templates only
- Cursor `cursor_project_rule`
- OpenCode `opencode_project_skill`

## Local setup

1. Install dependencies.

```bash
pnpm install
```

2. Prepare env files.

```bash
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/desktop-ui/.env.example apps/desktop-ui/.env
```

If the per-app `.env.example` files do not exist in your local branch yet, create `.env` files with the same backend URL and database/redis settings used by the root `.env.example`.

3. Start infra.

```bash
pnpm dev:infra
```

Expected defaults:

- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`

4. Start the backend.

```bash
pnpm dev:backend
```

5. Start the desktop shell.

```bash
pnpm dev:desktop:tauri
```

If you only run `pnpm dev:desktop`, the React shell will load in browser preview mode, but native install commands will stay disabled.

## Minimal verification

1. Confirm backend health.

```bash
curl http://127.0.0.1:3000/health
```

2. Open the desktop app and wait for runtime sync to show discovered tools and the current device state.

3. Search for a skill that supports `cursor` or `opencode`.

4. Open the skill drawer and run the wizard:
   - `Select workspace via Tauri`
   - `Preview target`
   - `Create install ticket`
   - `Apply in native core`

5. Validate the result:
   - the drawer shows `ticket_issued -> downloading -> staging -> verifying -> committing -> success`
   - the “My installs” section shows the new active binding
   - a local file exists at one of the verified project targets:
     - `<workspace>/.cursor/rules/<skill-slug>.mdc`
     - `<workspace>/.opencode/skills/<skill-slug>/SKILL.md`

6. Optional backend verification:

```bash
curl -H "Authorization: Bearer <desktop-token>" http://127.0.0.1:3000/api/my/installs
```

## Checks

Type and unit checks used for this slice:

```bash
pnpm --filter @prime/backend exec tsc --noEmit
pnpm --filter @prime/desktop-ui exec tsc --noEmit
cd apps/native-core && cargo test
```

Backend integration tests require PostgreSQL and Redis to be running on the default local ports:

```bash
pnpm backend:test:integration
```

## Current gaps

- Backend integration tests still depend on a real local PostgreSQL/Redis stack
- Tauri apply currently writes a minimal placeholder payload instead of downloading and unpacking a real skill artifact
- rollback and verify interfaces are preserved, but not implemented yet
- browser preview mode cannot execute local installation
