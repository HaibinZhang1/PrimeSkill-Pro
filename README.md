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
- Desktop UI reads `GET /api/my/installs` to render “我的安装”
- Native Core can fetch real `package_uri` artifacts as zip payloads or legacy `prime_skill_package.v1` JSON packages
- Desktop UI and admin-web have started the first “Chinese-first” copy cleanup for user-facing text

The current apply path is intentionally limited:

- project scope only
- verified templates only
- Cursor `cursor_project_rule`
- OpenCode `opencode_project_skill`

Current non-default paths:

- `Cline` / `Codex` are still Windows PoC only
- `global` install is still Windows PoC only
- browser preview mode still cannot execute local installation

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
   - opening `View details` on the installed card shows:
     - backend install detail from `GET /api/my/installs/:id`
     - local registry file metadata from Tauri `get_installation_detail`
     - local verification from Tauri `verify_installation`

6. Validate uninstall:
   - from install detail, click `Uninstall`
   - the drawer shows `ticket_issued -> downloading -> staging -> verifying -> committing -> success`
   - the managed local files are removed or restored from previous content
   - the “My installs” section refreshes and no longer shows the removed binding

7. Optional backend verification:

```bash
curl -H "Authorization: Bearer <desktop-token>" http://127.0.0.1:3000/api/my/installs
```

8. Validate drift detection:
   - from install detail, click `Verify`
   - intact installs report `verified` and backend writes `last_verified_at`
   - if a managed file is edited or deleted locally, `Verify` reports `drifted`
   - drifted bindings remain visible in `My installs` and can still be uninstalled or rolled back

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
- Native apply can now fetch `package_uri` artifacts as either zip payloads or legacy `prime_skill_package.v1` JSON documents, but backend-side artifact build/publish is still minimal
- rollback is implemented as a local file-content boundary for `replace` and `managed_block`, but backend-side verify/artifact provenance is still incomplete
- verify is now a minimal local-real loop that updates `last_verified_at` and `active/drifted`, but it still does not use install tickets or artifact re-fetch
- browser preview mode cannot execute local installation
