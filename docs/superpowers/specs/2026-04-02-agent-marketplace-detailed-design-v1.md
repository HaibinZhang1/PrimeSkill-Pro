# 企业内网 Agent Skills 管理市场：详细设计 v1（可施工版）

> 基线文档：`docs/superpowers/specs/2026-04-01-agent-marketplace-design.md`  
> 目标：在不改变既定主路线前提下，补齐可直接进入开发的详细设计与实施边界。  
> 适用部署：企业内网，Linux + Nginx + PostgreSQL + Redis，Windows 桌面端（Tauri + Rust Native Core），管理后台 Web。

---

## 0. 冲突识别与最小改动修正（先于开发）

### 0.1 冲突清单

1. **搜索能力分阶段冲突**
- 现状：Phase 1 写“关键词 + metadata 过滤”。
- 约束：必须全量满足“权限前置过滤 + 混合召回 + LLM 后置整理 + 两阶段索引”。
- 结论：两者冲突。

2. **Manifest 拉取调用方边界冲突**
- 现状：接口清单中 `/api/install-tickets/:ticketId/manifest` 位于 Desktop UI 调用范畴。
- 定稿原则：票据消费与安装执行属于 Native Core。
- 结论：边界冲突。

3. **Install Ticket 一次性 vs 幂等重试语义冲突**
- 现状：同时要求“一次性消费”与“幂等可重试”，缺少精确定义。
- 结论：状态机语义不完整，可能导致票据重放漏洞。

4. **OpenCode 全局路径在 Windows 语义不稳定**
- 现状：`${userHome}/.config/opencode/...` 在 Windows 作为 candidate。
- 结论：可保留，但不可默认生产模板，需明确 Windows 真机验证前置。

5. **潜在偏航项：统一 `.agentskills`**
- 现状：旧方案中出现统一目录倾向。
- 约束：路径治理必须由数据库模板三表驱动，不允许统一目录主路线。

### 0.2 最小改动修正方案

1. 将“搜索四件套”提升为 **Phase 1 必选能力**；允许低配参数，不允许能力缺失。  
2. 新增 Native 专用命名空间：`/api/native/install-tickets/*`，Desktop UI 只申请票据与展示进度。  
3. `install_ticket` 增加字段：
- `consume_mode ENUM('one_time','idempotent_retry')`
- `retry_token VARCHAR(128) NULL`
4. OpenCode 全局模板维持 `candidate`，默认推荐策略仅包含 `verified`。  
5. 明确禁止任何“统一写 `.agentskills`”实现进入主分支。

---

## A. 总体目标与范围

### A.1 本轮详细设计覆盖项

1. 领域模型与状态机（Skill、审核、安装、ticket、索引）。
2. PostgreSQL 详细建模（约束、索引、幂等、并发锁、审计字段）。
3. API 详细边界（Admin/Desktop/Native/Worker）与核心接口契约。
4. 安装治理闭环（install/upgrade/uninstall/rollback + 补偿 + 并发）。
5. 搜索链路闭环（stage1/stage2 + 权限前置 + 混合召回 + LLM 后置）。
6. 工具路径模板策略（Cursor/Cline/OpenCode/Codex，Windows 维度）。
7. 跨平台开发测试矩阵与 CI 门禁。
8. 风险分级与可执行落地任务。

### A.2 本轮不覆盖项

1. SaaS 多租户与跨企业隔离。
2. 商业计费、许可证发放与结算。
3. 多机房双活/异地灾备。
4. 移动端或浏览器直接安装能力。

### A.3 必须先做阻塞项（开工门槛）

1. 冻结 Backend/Native/Worker 契约（OpenAPI + IPC + Queue payload schema）。
2. 完成安装治理核心 migration（`install_record/install_ticket/local_install_binding`）。
3. 完成模板治理核心 migration（`ai_tool_catalog/template/detection_rule`）。
4. 完成搜索双索引核心 migration（`skill_search_profile/skill_document` + 向量索引）。
5. 明确 ticket 消费模式与幂等策略实现。

---

## B. 领域模型与状态机

### B.1 Skill 生命周期状态机

`draft -> pending_review -> approved -> published -> archived`

补充分支：
- `pending_review -> rejected -> draft`
- `published -> archived`
- `archived -> draft`（仅 platform_admin，可选）

状态迁移约束：
1. 仅 `dept_admin/platform_admin` 可提交审核。
2. 仅 `reviewer/security_admin/platform_admin` 可审批。
3. `published` 需满足：
- `review_task.status='approved'`
- `skill_version.stage1_index_status in ('processing','ready')`（允许先上架后补 stage2）
4. 对外搜索默认仅返回 `published` 且权限可见版本。

### B.2 审核流状态机（review_task）

`created -> assigned -> in_review -> approved|rejected -> closed`

关键规则：
1. 审核人不可审批自己提交版本（同人回避）。
2. `rejected` 必填 `comment`。
3. 每次重提审创建新 `review_task`，`review_round` 自增。

### B.3 安装操作流状态机（install_record.install_status）

`pending -> ticket_issued -> downloading -> staging -> verifying -> committing -> success`

失败与回滚分支：
- 任一阶段失败：`failed`
- 若已有可回滚快照：`failed -> rolling_back -> rolled_back`

规则：
1. 状态推进必须单调，不允许回退写。
2. 每次推进写入 `status_version`（乐观锁）。
3. 终态：`success|failed|rolled_back|cancelled`。

### B.4 Ticket 生命周期（install_ticket）

`issued -> consumed|expired|cancelled`

模式定义：
1. `consume_mode=one_time`：仅允许一次成功 consume。
2. `consume_mode=idempotent_retry`：允许同 `idempotency_key + retry_token` 重试，返回同一操作上下文。
3. 票据绑定：`user_id + client_device_id + install_record_id`，任一不匹配拒绝。

### B.5 索引状态机（skill_version）

- `stage1_index_status`: `pending|processing|ready|failed`
- `stage2_index_status`: `pending|processing|ready|failed`
- `search_ready_at`: 两阶段都 `ready` 时写入。

检索策略：
1. 默认“严格模式”：stage1+stage2 都 ready。
2. 降级模式：仅 stage1 ready，但返回 `degraded_reason=stage2_not_ready`。

---

## C. 数据库详细设计

### C.1 表清单（按域分组）

1. IAM 与组织：
- `user`
- `department`
- `role`
- `permission`
- `user_role`
- `role_permission`

2. Skill 与审核：
- `skill`
- `skill_version`
- `skill_category`
- `skill_tag`
- `skill_tag_rel`
- `skill_permission_rule`
- `review_task`

3. 搜索索引：
- `skill_search_profile`（stage1）
- `skill_document`（stage2）

4. 安装治理：
- `client_device`
- `tool_instance`
- `workspace_registry`
- `install_record`
- `install_ticket`
- `local_install_binding`
- `skill_usage_event`

5. 路径治理：
- `ai_tool_catalog`
- `ai_tool_install_target_template`
- `ai_tool_detection_rule`

6. 审计：
- `audit_log`

### C.2 关键字段与约束（补充到 migration）

#### 1) `install_record`
- 新增：`status_version INT NOT NULL DEFAULT 0`
- 新增：`operation_seq BIGINT NOT NULL DEFAULT 1`
- 建议唯一：`UNIQUE(source_client_id, operation_type, idempotency_key)`（`idempotency_key` 非空时生效）
- 索引：
  - `idx_install_record_lock_key(lock_key)`
  - `idx_install_record_user_created(user_id, created_at DESC)`
  - `idx_install_record_trace(trace_id)`

#### 2) `install_ticket`
- 新增：`consume_mode VARCHAR(32) NOT NULL DEFAULT 'one_time'`
- 新增：`retry_token VARCHAR(128)`
- 索引：
  - `idx_ticket_record_status(install_record_id, status)`
  - `idx_ticket_user_device(user_id, client_device_id)`

#### 3) `local_install_binding`
- 业务唯一（active 绑定唯一）：
  - `UNIQUE(client_device_id, resolved_target_path, state)`（state='active' 部分唯一）
- 索引：
  - `idx_binding_skill_device(skill_id, client_device_id, state)`
  - `idx_binding_workspace(workspace_registry_id, state)`

#### 4) `ai_tool_install_target_template`
- 唯一：`UNIQUE(tool_id, template_code, template_revision, os_type)`
- 默认模板唯一（按 tool+os+scope+artifact）：
  - `UNIQUE(tool_id, os_type, scope_type, artifact_type) WHERE is_default=true AND release_status='active'`
- 索引：
  - `idx_template_verify(verification_status, release_status, os_type)`

#### 5) `skill_search_profile`
- 索引：
  - `GIN(keyword_document gin_trgm_ops)`
  - `HNSW(head_embedding vector_cosine_ops)`（或 IVFFLAT，按 pgvector 版本）

#### 6) `skill_document`
- 索引：
  - `idx_doc_version(skill_version_id, chunk_index)`
  - `HNSW(embedding vector_cosine_ops)`

### C.3 幂等键设计

1. Desktop 发起安装时必须传 `idempotency_key`（UUIDv7）。
2. 键作用域：`user_id + client_device_id + operation_type + skill_id + tool_instance_id + target_scope + workspace_registry_id`。
3. 24h 内重复请求返回同一 `install_record_id` 与可重用语义结果。

### C.4 并发锁键设计

1. 统一 `lock_key = sha256(client_device_id + ':' + resolved_target_path)`。
2. 双层锁：
- Redis 分布式锁（快速失败，TTL 120s，续约）。
- PostgreSQL advisory lock（事务级最终互斥）。

### C.5 审计字段规范

所有核心表统一审计字段：
- `created_at`, `created_by`, `updated_at`, `updated_by`
- 关键链路追加：`trace_id`, `source_ip`, `source_client_id`

`audit_log` 最小要求：
- `actor_user_id`
- `action`
- `resource_type/resource_id`
- `payload_json`
- `ip`
- `created_at`

---

## D. API 详细设计

### D.1 服务边界

1. **Admin Portal -> Backend**：`/api/admin/*`
2. **Desktop UI -> Backend**：`/api/desktop/*`
3. **Native Core -> Backend**：`/api/native/*`
4. **Worker -> Backend/Internal**：`/api/internal/*`（仅内网服务账号）

### D.2 鉴权模型

1. 用户态：`Authorization: Bearer <jwt>`。
2. 设备态：`X-Device-Token`（设备注册后发放）。
3. Native 核心接口：必须 `jwt + device_token + ticket_id` 三重绑定。
4. 角色覆盖：`platform_admin / security_admin / dept_admin / reviewer / normal_user`。

### D.3 核心接口契约（可直接落 OpenAPI）

#### 1) 申请安装票据
`POST /api/desktop/install-tickets`

请求：
```json
{
  "skillId": 123,
  "skillVersionId": 456,
  "operationType": "install",
  "targetScope": "project",
  "toolInstanceId": 901,
  "workspaceRegistryId": 333,
  "idempotencyKey": "018f..."
}
```

响应：
```json
{
  "ticketId": "tk_xxx",
  "installRecordId": 789,
  "consumeMode": "one_time",
  "expiresAt": "2026-04-02T10:00:00Z"
}
```

错误码：
- `403_NO_USE_PERMISSION`
- `409_INSTALL_CONFLICT`
- `422_TEMPLATE_NOT_AVAILABLE`

鉴权：`normal_user` 可调用；服务端执行权限+模板可用性+设备归属校验。

#### 2) Native 拉取 Manifest
`GET /api/native/install-tickets/{ticketId}/manifest`

响应：
```json
{
  "ticketId": "tk_xxx",
  "installRecordId": 789,
  "package": {
    "uri": "https://intranet-obj/...",
    "checksum": "sha256:...",
    "signature": "base64..."
  },
  "template": {
    "templateId": 12,
    "templateCode": "cursor_project_rule",
    "templateRevision": 3,
    "targetPathTemplate": "${workspaceRoot}/.cursor/rules",
    "filenameTemplate": "${skillKey}.mdc",
    "packagingMode": "single_file",
    "contentManagementMode": "replace"
  },
  "variables": {
    "workspaceRoot": "D:/repo/demo",
    "skillKey": "api-contract"
  },
  "verifyRules": ["checksum", "signature", "file_exists"]
}
```

错误码：
- `401_DEVICE_UNTRUSTED`
- `404_TICKET_NOT_FOUND`
- `410_TICKET_EXPIRED`
- `409_TICKET_ALREADY_CONSUMED`

鉴权：设备 token 必须与 ticket 绑定设备一致。

#### 3) Native 回传阶段状态
`POST /api/native/install-tickets/{ticketId}/consume`

请求：
```json
{
  "installRecordId": 789,
  "stage": "verifying",
  "result": "ok",
  "traceId": "tr_xxx",
  "telemetry": {
    "downloadMs": 231,
    "verifyMs": 42
  }
}
```

响应：
```json
{
  "nextAction": "continue"
}
```

错误码：
- `412_STAGE_OUT_OF_ORDER`
- `409_RECORD_STATUS_CONFLICT`

#### 4) 上报安装终态
`POST /api/native/install-operations/{installRecordId}/report`

请求：
```json
{
  "finalStatus": "success",
  "resolvedTargetPath": "D:/repo/demo/.cursor/rules/api-contract.mdc",
  "managedFileHashes": ["sha256:..."],
  "backupSnapshotPath": "C:/Users/.../snapshots/789",
  "traceId": "tr_xxx"
}
```

错误码：
- `409_RECORD_ALREADY_FINALIZED`
- `422_INVALID_FINAL_STATUS`

#### 5) 搜索接口
`POST /api/desktop/search/skills`

请求：
```json
{
  "query": "自动生成前后端API",
  "page": 1,
  "pageSize": 10,
  "toolContext": ["cursor"],
  "workspaceContext": {
    "workspaceRegistryId": 333
  }
}
```

响应：
```json
{
  "degraded": false,
  "items": [
    {
      "skillId": 123,
      "skillVersionId": 456,
      "name": "API Contract Assistant",
      "whyMatched": "命中 OpenAPI + SDK codegen 场景",
      "supportedTools": ["cursor", "opencode"],
      "visibilityReason": "department_allow",
      "recommendedInstallMode": "project",
      "confidenceScore": 0.88
    }
  ]
}
```

错误码：
- `400_QUERY_INVALID`
- `503_SEARCH_SERVICE_DEGRADED`

#### 6) 管理端模板发布
`POST /api/admin/ai-tool-templates`

请求：模板全字段（必须含 `template_revision`，不可覆盖旧 revision）。

错误码：
- `409_TEMPLATE_REVISION_EXISTS`
- `422_INVALID_TEMPLATE_VARIABLES`
- `403_ROLE_FORBIDDEN`

### D.4 错误码分层规范

1. `AUTH_*`：登录、token、设备信任。
2. `PERM_*`：角色或资源权限不足。
3. `INSTALL_*`：安装流程失败。
4. `TICKET_*`：票据状态冲突。
5. `SEARCH_*`：检索链路故障。
6. `INDEX_*`：索引构建失败。

统一响应格式：
```json
{
  "code": "INSTALL_CONFLICT",
  "message": "lock key occupied",
  "requestId": "req_xxx",
  "traceId": "tr_xxx"
}
```

---

## E. 安装治理详细流程

### E.1 install 时序（标准路径）

1. Desktop UI 获取本地 `tool_instance/workspace` 并发起 `install ticket` 申请。
2. Backend 完成权限、模板 revision、版本兼容校验，写入 `install_record + install_ticket`。
3. Native Core 拉取 manifest（ticket 绑定校验）。
4. Native 下载包到 staging 目录，完成 checksum + signature 校验。
5. Native 解析模板变量，生成 `resolved_target_path`。
6. Native 执行原子写入：
- 文件：`tmp file -> fsync -> rename`
- 目录：`tmp dir -> verify -> swap`
7. Native 更新本地 SQLite 注册表（事务）。
8. Native 回传终态；Backend 更新 `local_install_binding` 与审计。

### E.2 upgrade 时序

1. 读取 `local_install_binding(active)` 与本地注册表。
2. 校验：新版本是否兼容工具版本、权限是否仍有效、模板是否可升级。
3. 生成快照：
- 文件安装：备份旧文件
- 目录安装：快照目录 + hash 清单
4. 执行 install 新版本。
5. verify 失败时自动 rollback 并标记 `rolled_back`。

### E.3 uninstall 时序

1. 定位托管对象：目录或受管块。
2. `directory`：删除托管目录。
3. `append/merge(managed_block)`：仅删除受管块。
4. 更新注册表与 `local_install_binding.state=removed`。
5. 保留历史 install_record，不做硬删除。

### E.4 rollback 时序

1. 触发条件：
- 安装/升级 verify 失败
- 用户主动回滚
2. Native 从最近快照恢复。
3. 恢复后 verify。
4. 新增 `install_record(operation_type='rollback')`。
5. 更新 active binding 指向回滚版本。

### E.5 失败补偿

1. 下载失败：3 次指数退避，仍失败则 `failed`。
2. 校验失败：禁止 commit，直接回滚。
3. commit 后回执失败：本地离线队列补报。
4. Backend 与本地不一致：`ReconcileJob` 进行对账并修复。

### E.6 并发冲突处理

1. 同 `lock_key` 仅允许一个活跃操作。
2. 幂等重试复用 `install_record`，不重复落盘。
3. 冲突返回 `409_INSTALL_CONFLICT`，附当前活动记录 ID。

---

## F. 搜索链路详细设计

### F.1 Stage1（快速候选召回）

输入：`query + user_id + tool_context + workspace_context`

流程：
1. Query Rewrite（规则优先，模型可选）。
2. Backend 生成权限 SQL 约束（可见+可用+非 deny）。
3. 在 `skill_search_profile` 执行三路召回：
- 向量召回（head_embedding）
- 关键词召回（keyword_document）
- 规则召回（标签/分类/工具兼容/热度）
4. 合并去重得 top 50~100 候选版本。

### F.2 Stage2（候选内语义补强）

1. 仅在候选 skill_version 集合内检索 `skill_document`。
2. 抽取 top chunks 构造 `why_matched evidence`。
3. 规则重排（权限完全匹配、工具兼容、评分、活跃度）。
4. LLM 后置整理输出 top 5~10（不允许增量引入候选外结果）。

### F.3 权限过滤落点

必须落在 Stage1 检索前的 SQL 约束层，不允许“先召回再过滤”。

### F.4 缓存策略

1. Query Rewrite 缓存：60s。
2. Stage1 候选缓存：30s。
3. 最终结果缓存：30s。
4. 缓存 key 必须包含 `permission_digest`，角色变更立即失效。

### F.5 降级策略

1. Stage2 不可用：返回 Stage1 结果，`degraded_reason=stage2_unavailable`。
2. LLM 不可用：返回规则重排结果，`degraded_reason=llm_unavailable`。
3. 向量不可用：关键词 + 规则兜底，`degraded_reason=vector_unavailable`。

---

## G. 工具路径模板策略（Windows）

> 路径治理唯一来源：`ai_tool_catalog` + `ai_tool_install_target_template` + `ai_tool_detection_rule`。

### G.1 模板状态策略

1. `verified`：可默认推荐与生产下发。
2. `candidate`：可见不可默认，需灰度白名单。
3. `deprecated`：禁止新安装，仅保留历史升级迁移。

### G.2 首批工具模板（Windows）

1. Cursor
- 项目规则：`${workspaceRoot}/.cursor/rules/${skillKey}.mdc` -> `verified`
- 项目 `AGENTS.md` 受管块追加 -> `candidate`（需要 Windows 真机验证）

2. Cline
- 项目技能目录：`${workspaceRoot}/.cline/skills/${skillKey}/SKILL.md` -> `candidate`（需要 Windows 真机验证）
- 项目 `.clinerules` 受管块 -> `candidate`（需要 Windows 真机验证）
- 全局目录：`${userHome}/.cline/skills/${skillKey}/SKILL.md` -> `candidate`（需要 Windows 真机验证）

3. OpenCode
- 项目目录：`${workspaceRoot}/.opencode/skills/${skillKey}/SKILL.md` -> `verified`
- 全局目录：`${userHome}/.config/opencode/skills/${skillKey}/SKILL.md` -> `candidate`（需要 Windows 真机验证）
- 兼容目录：`${workspaceRoot}/.agents/skills/${skillKey}/SKILL.md` -> `candidate`（非主路径）

4. Codex
- 项目 `AGENTS.md` 受管块 -> `candidate`（需要 Windows 真机验证）

### G.3 受管块协议（append/merge）

1. 块标记：`BEGIN PRIME_SKILL:<skillKey>` / `END PRIME_SKILL:<skillKey>`。
2. 注册表保存：受管块哈希、文件版本、offset 信息。
3. 升级：仅替换块内内容。
4. 卸载：仅删除块，保留用户非托管内容。
5. 块内被用户编辑时：进入冲突确认流程，默认不覆盖。

---

## H. 跨平台研发与测试

### H.1 研发分工

1. macOS：Backend/Admin/Desktop UI/Mock Native。
2. Windows 真机：Native Core + 路径/安装生命周期验证。
3. Linux：服务端部署、性能与稳定性验证。

### H.2 Contract Test 体系

1. OpenAPI Contract（Admin/Desktop/Native）。
2. IPC Contract（Tauri commands/events）。
3. Queue Contract（IndexJob/InstallEvent/ReconcileEvent）。

### H.3 CI 矩阵

1. Linux Runner：
- lint
- unit test
- integration test
- migration check
- search pipeline test

2. Windows Runner：
- Native Core unit test
- 模板解析测试
- 工具扫描测试
- install/upgrade/uninstall/rollback E2E

### H.4 CI 强制门禁

1. `search_permission_prefilter_test` 必须通过。
2. `install_lifecycle_e2e_windows` 必须通过。
3. migration 向后兼容检查必须通过。

---

## I. 风险与待确认项

### I.1 高风险

1. `append/merge` 误改用户文件。
- 规避：受管块协议、块哈希、冲突提示、默认 candidate。

2. Windows 路径不一致导致安装失败。
- 规避：按 `tool_version + os_type` 细分模板；检测规则多策略；真机回归。

3. ticket 重放或跨设备消费。
- 规避：短时效、设备绑定、consume_mode、审计告警。

### I.2 中风险

1. CPU-only 向量化吞吐不足。
- 规避：异步索引、分级索引、低峰批处理、缓存。

2. 权限缓存不一致。
- 规避：permission_digest 入缓存键，角色变更主动失效。

3. 回执丢失导致状态漂移。
- 规避：本地离线队列 + ReconcileJob。

### I.3 低风险

1. 热门技能挤压长尾。
- 规避：热度权重上限。

2. 审核吞吐不足。
- 规避：按部门分派 reviewer 与批量操作。

### I.4 待确认（必须标注）

1. Cline Windows 项目/全局路径稳定性（需要 Windows 真机验证）。
2. Codex `AGENTS.md` 受管块升级/卸载回滚稳定性（需要 Windows 真机验证）。
3. OpenCode Windows 全局路径约定与可写性（需要 Windows 真机验证）。

---

## J. 最终落地清单（可执行任务，按优先级）

### J.1 P0（阻塞，必须先做）

1. 冻结 API/IPC/Queue 契约并评审签字。
2. 完成 `install_ticket` 语义修正 migration（`consume_mode/retry_token`）。
3. 完成路径治理三表 migration 与初始化种子。
4. 完成安装治理五表 migration 与索引/唯一约束。
5. 完成搜索两阶段表 migration 与向量索引。
6. 实现权限前置过滤 SQL 生成器（搜索统一入口）。
7. 实现 install lock（Redis + PG advisory lock）。
8. Native Core 完成 staging + 原子落盘 + SQLite 注册表事务。
9. Worker 完成 stage1/stage2 索引流水线。
10. 建立 Windows 真机 install lifecycle 自动化回归。

### J.2 P1（核心能力）

11. 实现 install/upgrade/uninstall/rollback 全状态机与补偿逻辑。
12. 实现模板 revision 不可变发布与默认模板切换策略。
13. 实现设备注册、设备信任撤销与设备心跳。
14. 实现审核流多轮机制（`review_round`）与审计。
15. 实现搜索三路混合召回 + LLM 后置整理（可降级）。
16. 实现 ReconcileJob 对账修复。

### J.3 P2（增强项）

17. 搜索缓存与失效策略上线。
18. 排行榜聚合与搜索重排联动。
19. 模板灰度发布控制台（candidate 白名单）。
20. 统一可观测性面板（安装成功率、回滚率、搜索降级率）。

---

## 附录 A：角色能力矩阵（最小可用）

1. `platform_admin`
- 全域用户、角色、模板、审核、发布、归档、审计查看。

2. `security_admin`
- 审核策略、deny 规则、设备信任管理、审计查看。

3. `dept_admin`
- 部门内 Skill 管理、提审、发布申请、部门授权。

4. `reviewer`
- 审核任务处理与意见回填。

5. `normal_user`
- 搜索、查看、收藏、评分、安装/升级/卸载/回滚（仅授权范围）。

---

## 附录 B：开发实施要求

1. 不允许把路径硬编码在 Desktop UI 或 Native Core 常量中；仅允许模板解析。
2. 不允许直接以本地扫描结果决定安装落点；必须先拿 install ticket/manifest。
3. 不允许任何安装操作绕过 `install_record` 与 `audit_log`。
4. 不允许先全库召回再做权限过滤。
5. `candidate` 模板未经 Windows 真机验证，不可升 `verified`。

