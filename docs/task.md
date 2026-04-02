# Agent Skills 市场 v1.0 当前任务总表

更新时间：2026-04-02

说明：
- 本文件基于 `docs/PLAN.md`、`docs/superpowers/specs/2026-04-01-agent-marketplace-design.md` 与当前仓库实测结果重新整理。
- “已完成”仅表示仓库里已有对应文件，且本轮已做过最小验证；不再把“只有骨架/只有接口定义”的内容记为完成闭环。
- 当前阶段主目标不是直接补完所有产品能力，而是先让整个项目具备可重复、可验证的启动路径。

## 1. 当前已验证的事实

### 1.1 仓库基础
- [x] Monorepo 基础目录已存在：`apps/*`、`packages/*`、`infra/*`、`docs/*`、`tests/*`。
- [x] 根工作区已存在：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- [x] 基础契约文件已存在：
  - `packages/contracts-openapi/openapi.yaml`
  - `packages/contracts-ipc/commands.schema.json`
  - `packages/contracts-ipc/events.schema.json`
  - `packages/contracts-events/queue-events.schema.json`
  - `packages/shared-types/src/*`
- [x] 数据库 migration 与 Docker 基础编排文件已存在：
  - `infra/db/migrations/*`
  - `infra/docker/docker-compose.yml`
  - `infra/docker/backend.Dockerfile`
  - `infra/docker/worker.Dockerfile`
  - `infra/docker/nginx.conf`

### 1.2 当前可以启动的组件
- [x] Backend 可在当前环境启动：`pnpm --filter @prime/backend start`。
- [x] Search Worker 可在当前环境以 standalone 模式启动：`pnpm --filter @prime/search-worker start`。
- [x] Admin Web 最小 Vite 应用可在当前环境启动：`pnpm dev:admin`。
- [x] Desktop UI 最小 Vite 应用可在当前环境启动：`pnpm dev:desktop`。
- [x] Docker 栈下 Backend 可启动并通过 Nginx 对外提供健康检查：`pnpm test:docker:acceptance`。
- [x] Docker 栈下 Admin Web 已可通过浏览器访问：`http://127.0.0.1:8080`。
- [x] 根级启动脚本已可调起 backend / worker / admin / desktop：
  - `pnpm dev:backend`
  - `pnpm dev:worker`
  - `pnpm dev:admin`
  - `pnpm dev:desktop`
- [x] Docker Compose 静态配置可解析，且包含 `db-init` 初始化链路：`docker compose -f infra/docker/docker-compose.yml config`。

### 1.3 当前仅为骨架、还不能算“可启动应用”的部分
- [x] `apps/admin-web` 已具备最小 React + Vite 启动壳，但仍未接入真实业务页面。
- [x] `apps/desktop-ui` 已具备最小 React + Vite 启动壳，并新增 `src-tauri` 宿主工程与 `tauri:dev` / `tauri:build` 脚本。
- [x] `apps/native-core` 已通过 `native_bootstrap_status` 最小命令接入 Tauri 宿主，但仍不是完整 Native 执行链路。

### 1.4 本轮实际跑过的校验
- [x] `./tests/foundation/p0_contracts_test.sh`
- [x] `./tests/foundation/p0_migrations_test.sh`
- [x] `./tests/foundation/p0_startup_skeleton_test.sh`
- [x] `./tests/foundation/p0_tauri_host_test.sh`
- [x] `./tests/foundation/p0_docker_init_test.sh`
- [x] `./scripts/ci/search_permission_prefilter_test.sh`
- [x] `./scripts/ci/search_worker_queue_smoke_test.sh`
- [x] `./scripts/ci/backend_integration_test.sh`
- [x] `./scripts/ci/docker_acceptance_test.sh`
- [x] `./scripts/ci/startup_smoke_test.sh`
- [x] `./scripts/verify_foundation.sh`
- [x] `pnpm test:p0`
- [x] `pnpm test:p0:tauri`
- [x] `pnpm test:p0:docker-init`
- [x] `pnpm test:docker:acceptance`
- [x] `pnpm test:worker:queue-smoke`
- [x] `pnpm test:startup`
- [x] `pnpm dev:infra`
- [x] `pnpm dev:infra:down`
- [x] `pnpm --filter @prime/backend exec tsc --noEmit -p tsconfig.json`
- [x] `pnpm --filter @prime/backend exec tsx --test test/health.integration.test.ts`
- [x] `pnpm --filter @prime/search-worker exec tsx --test test/boot.test.ts`
- [x] `pnpm --filter @prime/backend start`
- [x] `pnpm --filter @prime/search-worker start`
- [x] `pnpm --filter @prime/admin-web build`
- [x] `pnpm --filter @prime/desktop-ui build`
- [x] `curl http://127.0.0.1:3000/health`
- [x] `docker compose -f infra/docker/docker-compose.yml config`

## 2. 当前阻塞“成功启动整个项目”的问题

### 2.1 P0 阻塞项
- [ ] Tauri 宿主工程已接入，但当前环境尚未在安装 `cargo` 的前提下完成真实编译与运行验证。
- [ ] `apps/native-core` 已打通最小 bootstrap 命令，但尚未接入文件系统执行、注册表管理和安装生命周期命令。
- [ ] 现有 `startup_smoke_test.sh` 仍未合并 Docker 初始化与 Tauri Rust 宿主全链路；当前是通过独立脚本 `pnpm test:docker:acceptance` 覆盖 Docker 验收。

### 2.2 当前环境阻塞项
- [ ] `cargo test`
  - 当前结果：`cargo: command not found`
  - 说明：Native Core 与 Tauri 宿主无法在当前环境编译/测试。
- [ ] `pnpm dev:desktop:tauri`
  - 当前结果：`failed to run 'cargo metadata' ... No such file or directory (os error 2)`
  - 说明：Tauri CLI 已能识别宿主工程，但当前机器缺少 Rust/Cargo 工具链，无法完成真实宿主启动。
- [ ] `pwsh -File ./scripts/ci/install_lifecycle_e2e_windows.ps1`
  - 当前结果：`pwsh: command not found`
  - 说明：Windows E2E 脚本无法在当前环境执行。

## 3. 为达成“成功启动整个项目”的剩余任务

### 3.1 先补齐可启动骨架
- [x] 为 `apps/admin-web` 新增 `package.json`、`tsconfig.json`、Vite 前端构建配置与最小启动页面。
- [x] 为 `apps/desktop-ui` 新增 `package.json`、`tsconfig.json`、Vite 前端构建配置与最小启动页面。
- [x] 为桌面端补齐 Tauri 配置、宿主启动命令与开发期目录结构。
- [ ] 将 `apps/native-core` 接入桌面宿主工程，至少能暴露一个最小可调用命令并完成联调。
  - 现状：最小命令 `native_bootstrap_status` 已落地，当前仅差在安装 `cargo` 的环境中完成真实宿主联调验证。

### 3.2 固化统一启动方式
- [x] 在根 `package.json` 增加统一脚本：
  - `dev:backend`
  - `dev:worker`
  - `dev:admin`
  - `dev:desktop`
  - `dev:stack`
  - `docker:up`
  - `docker:down`
- [x] 增加 `.env.example`，明确 `DATABASE_URL`、`REDIS_URL`、`PORT`、`SEARCH_WORKER_MODE` 等基础变量。
- [x] 更新 `README.md`，提供从零启动步骤与健康检查方式。

### 3.3 打通基础依赖启动链路
- [x] 增加数据库初始化脚本，确保 Docker 初始化链路会执行 extensions、migrations、seed。
  - 现状：`scripts/apply_migrations_order.sh` 已改为通过 `psql` 真正执行 SQL，并以 `schema_migration` 跟踪已应用 migration。
  - 现状：`docker-compose.yml` 已新增 `db-init` 服务，`backend/worker` 会等待其完成。
- [x] 增加本地开发脚本，支持“先起 Postgres/Redis/MinIO，再起 backend/worker”。
  - 入口：`pnpm dev:infra` / `pnpm dev:infra:down`
  - 现状：当前 Mac 已完成一次真实启动与关闭验证，`db-init` 会执行 extensions、migrations、seed。
- [x] 为 backend 增加最小健康检查接口 `/health`，便于脚本和容器判断可用性。
- [x] 为 worker 增加 queue 模式启动说明与最小 smoke test，避免只有 standalone 日志输出。
  - 现状：`apps/search-worker/src/index.ts` 已抽出可测试的 `bootSearchWorker` 启动入口，`apps/search-worker/test/boot.test.ts` 覆盖 standalone / queue 两种模式。
  - 现状：新增 `scripts/ci/search_worker_queue_smoke_test.sh` 与根脚本 `pnpm test:worker:queue-smoke`，`pnpm test:startup` 已纳入该 smoke 校验。
- [x] 为 Docker 链路补齐真实前端入口与后端 HTTP 验收。
  - 现状：`infra/docker/nginx.Dockerfile` 已将 `admin-web` 构建产物打进网关镜像，`infra/docker/nginx.conf` 已代理 `/api/*` 和 `/health` 并托管前端静态页。
  - 现状：新增 `scripts/ci/docker_acceptance_test.sh` 与根脚本 `pnpm test:docker:acceptance`，已完成 Browser 入口、模板发布、搜索、install ticket 生命周期的 HTTP 验收。

### 3.4 建立“项目已成功启动”的验收脚本
- [x] 增加统一验收脚本 `scripts/ci/startup_smoke_test.sh`。
- [x] 当前验收脚本已覆盖：
  - startup 骨架文件与根脚本存在
  - `worker` queue 模式启动入口 smoke
  - `admin-web` / `desktop-ui` 可 build
  - `worker` 可通过根脚本启动
  - `backend` 可启动并返回 `/health`
  - `admin-web` / `desktop-ui` dev server 可访问
- [ ] 验收脚本仍需补齐：
  - desktop-ui/Tauri 宿主可启动
  - 如果希望只跑一个总入口，还需把 `pnpm test:docker:acceptance` 合并进统一“全项目启动验收”脚本
- [x] 已将该脚本接入本地一键验证入口：`pnpm test:startup`。

## 4. 达成“成功启动整个项目”的建议执行顺序

1. 先补 `admin-web` 与 `desktop-ui` 的 `package.json`、构建配置和启动脚本，让四个应用至少都有独立启动入口。
2. 然后把 `desktop-ui` 和 `native-core` 组装成最小可运行的 Tauri 壳，哪怕先只显示占位页面并暴露一个测试命令。
3. 接着补根脚本、`.env.example`、README 和健康检查，把手动启动变成标准化启动。
4. 再补数据库初始化与 startup smoke test，让“整个项目成功启动”可以被脚本验证。
5. 最后再回到更大的产品闭环能力建设。

## 5. 启动完成后的下一层任务

以下内容仍然是 `PLAN.md` 定义的正式范围，但不应继续和“项目能不能启动”混在同一优先级里：

### 5.1 Backend / Install 治理
- [ ] 补齐 device register / revoke / heartbeat。
- [ ] 补齐 audit_log、skill_usage_event、统计聚合。
- [ ] 补齐 upgrade / uninstall / rollback 完整状态机与失败补偿。
- [ ] 扩展集成测试，覆盖并发冲突、终态幂等、权限回收、失败补偿。

### 5.2 Search / Worker
- [ ] 从当前最小检索升级为三路混合召回：向量、关键词、规则。
- [ ] 实现 Stage2 evidence 检索与 `SearchAssembleJob`。
- [ ] 实现 `ReconcileJob`。
- [ ] 接入真实 embedding provider，替换 `MockEmbeddingProvider`。
- [ ] 增加缓存、降级和观测指标。

### 5.3 Native / Desktop 能力
- [ ] 实现工具扫描、workspace 选择、目标路径预览。
- [ ] 实现 `manifest -> apply -> consume -> report` 本地执行链路。
- [ ] 实现 staging、原子落盘、校验、快照、回滚。
- [ ] 实现本地 SQLite 注册表与事务化更新。

### 5.4 Admin Web
- [ ] 实现模板治理、审核流、candidate 灰度、可观测性页面。

### 5.5 Windows 真机验证
- [ ] 按 `docs/windows-verification-matrix.md` 执行 Cursor / Cline / OpenCode / Codex 的模板与安装验证。
- [ ] `candidate` 模板完成真机验证后再推进为 `verified`。

## 6. 当前结论

- [x] 当前仓库已经具备“backend + worker + admin-web + desktop-ui 最小骨架可启动”的基础。
- [x] 当前仓库已经具备“Docker 下 backend 可启动、admin-web 可访问、核心 API 可做 HTTP 验收”的基础。
- [ ] 当前仓库还不具备“整个项目成功启动”的条件。
- [ ] 当前剩余的首要阻塞已经收敛到：在有 `cargo` 的环境验证 Tauri 宿主、继续扩展 Native Core 命令，以及把 Docker 与 Tauri 验收统一收敛到单一总入口。
