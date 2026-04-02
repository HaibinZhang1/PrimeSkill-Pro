# PrimeSkill Pro

企业内网 Agent Skills 管理市场实现仓库（v1 foundation）。

## Workspace Layout

- `apps/backend`: NestJS API skeleton
- `apps/search-worker`: queue/索引 worker skeleton
- `apps/admin-web`: 管理后台 skeleton
- `apps/desktop-ui`: 桌面前端 skeleton
- `apps/native-core`: Rust Native Core skeleton
- `packages/contracts-openapi`: OpenAPI 契约
- `packages/contracts-ipc`: IPC 命令/事件契约
- `packages/contracts-events`: Queue 事件契约
- `packages/shared-types`: 共享错误码/枚举/DTO
- `infra/db/migrations`: PostgreSQL migration（M001-M009）
- `infra/docker`: docker compose 与 nginx 配置
- `infra/ci`: CI 门禁脚本与 pipeline 示例

## Quick Checks

```bash
./tests/foundation/p0_contracts_test.sh
./tests/foundation/p0_migrations_test.sh
./tests/foundation/p0_tauri_host_test.sh
./scripts/ci/search_worker_queue_smoke_test.sh
```

## Startup Baseline

当前仓库已经具备以下最小启动入口：

- `pnpm dev:backend`
- `pnpm dev:worker`
- `pnpm dev:admin`
- `pnpm dev:desktop`
- `pnpm dev:desktop:tauri`
- `SEARCH_WORKER_MODE=queue pnpm dev:worker`

后端健康检查：

```bash
curl http://127.0.0.1:3000/health
```

预期返回：

```json
{"ok":true,"service":"backend"}
```

## Local Setup

1. 安装依赖：

```bash
pnpm install
```

2. 准备环境变量：

```bash
cp .env.example .env
```

3. 启动基础依赖：

```bash
pnpm docker:up
```

4. 在另一个终端启动应用：

```bash
pnpm dev:backend
pnpm dev:worker
pnpm dev:admin
pnpm dev:desktop
```

5. 运行最小启动验收：

```bash
pnpm test:startup
pnpm test:worker:queue-smoke
pnpm test:docker:acceptance
```

本地依赖栈的标准入口：

```bash
pnpm dev:infra
pnpm dev:infra:down
```

Docker 启动完整后，可直接在浏览器访问：

```bash
open http://127.0.0.1:8080
curl http://127.0.0.1:8080/health
```

说明：
- `admin-web` 当前是最小管理端壳。
- `desktop-ui` 当前已补齐 `src-tauri` 宿主骨架，并通过 `native_bootstrap_status` 命令接入 `apps/native-core` 的最小联调。
- `search-worker` 当前支持 standalone / queue 两种启动模式，默认由环境变量控制；可通过 `pnpm test:worker:queue-smoke` 验证 queue 启动入口本身可用。
- 当前环境若未安装 `cargo`，`pnpm dev:desktop:tauri` 无法真正启动 Rust 宿主，但前端和宿主工程文件已经就位。
- `pnpm dev:infra` 会启动 `postgres/redis/minio`，等待 PostgreSQL healthy 后执行 `db-init`，自动完成 migration 与 seed。
- `pnpm test:docker:acceptance` 会拉起 Docker 栈，验收 `backend` 健康检查、`admin-web` 浏览器入口，以及核心 API 的 HTTP 链路。
