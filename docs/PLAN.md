# 企业内网 Agent Skills 管理市场完整实现方案 v1.0（可直接开工）

## 摘要
本方案严格继承两份定稿文档（2026-04-01 + 2026-04-02），不改主路线，直接给出可施工实现蓝图。  
部署决策：生产采用 **Linux + Nginx + PostgreSQL + Redis**，应用层采用 **Docker 容器化（Backend/Worker/MinIO）**，PostgreSQL 建议生产主机托管（可容器化于测试环境）；Windows 端采用 **Tauri + Rust Native Core**，管理端为 Web。

---

## A. 实施总览（目标、范围、非目标、关键原则）

### A1. 目标
1. 交付企业内网可用的 Skill 市场闭环：发布、审核、授权、搜索、安装、升级、卸载、回滚、审计。  
2. 搜索必须落地四件套：权限前置过滤、混合召回、LLM 后置整理、两阶段索引。  
3. 安装必须落地治理闭环：install ticket、manifest、staging、原子落盘、本地注册表、失败补偿、可回滚。  
4. 路径治理必须由三表驱动：`ai_tool_catalog / ai_tool_install_target_template / ai_tool_detection_rule`。

### A2. 范围
1. Backend（NestJS）+ Worker + Admin Web + Desktop UI + Native Core。  
2. PostgreSQL（含 pgvector）与 Redis 队列/缓存。  
3. Cursor/Cline/OpenCode/Codex 首批模板。  
4. 五角色模型：`platform_admin / security_admin / dept_admin / reviewer / normal_user`。

### A3. 非目标
1. SaaS 多租户跨企业隔离。  
2. 商业计费与许可证。  
3. 多机房双活。  
4. 移动端安装。

### A4. 关键原则
1. 后端是唯一策略与审计中心。  
2. Desktop UI 只编排，不直接落盘。  
3. Native Core 只执行票据授权后的本地动作。  
4. 禁止统一 `.agentskills` 主路线实现进入主分支。  
5. `candidate` 模板默认不推荐，必须 Windows 真机验证后再升 `verified`。

---

## B. 冲突核对与修正（最小改动）

### B1. 冲突清单
1. Phase 1“关键词+metadata”与“搜索四件套必选”冲突。  
2. `manifest/consume/report` 在桌面用户 API 中出现，和 Native 执行边界冲突。  
3. `install_ticket` “一次性消费”与“幂等重试”语义不完整。  
4. OpenCode Windows 全局路径稳定性不足。  
5. 旧倾向“统一 `.agentskills`”与路径治理三表冲突。  
6. `install_record.install_status` 在基线 SQL 与详细状态机枚举不一致。  
7. API 命名空间在基线文档存在 `/api/search/*` 与 v1 `/api/desktop/search/*` 不一致。

### B2. 修正方案（必须执行）
1. 搜索四件套纳入 P0，不可降级为后续阶段。  
2. 统一接口边界：  
3. `POST /api/desktop/install-tickets`（Desktop）  
4. `GET /api/native/install-tickets/{ticketId}/manifest`（Native）  
5. `POST /api/native/install-tickets/{ticketId}/consume`（Native）  
6. `POST /api/native/install-operations/{installRecordId}/report`（Native）  
7. `install_ticket` 增加 `consume_mode` 与 `retry_token`；明确定义 `idempotent_retry`。  
8. OpenCode 全局模板维持 `candidate`，默认不下发生产推荐。  
9. 删除所有统一 `.agentskills` 相关实现入口，仅保留“兼容 candidate 模板”。  
10. 统一 `install_status` 枚举到详细状态机：`pending -> ticket_issued -> downloading -> staging -> verifying -> committing -> success` + 失败/回滚分支。  
11. API 统一命名空间：`/api/admin/* /api/desktop/* /api/native/* /api/internal/*`。

---

## C. 代码仓库落地结构（目录与边界）

### C1. 推荐仓库形态（Monorepo）
1. `apps/backend`：NestJS API（IAM、Skill、审核、模板治理、安装治理、搜索编排、审计）。  
2. `apps/search-worker`：索引与检索 Worker（BullMQ consumer）。  
3. `apps/admin-web`：React 管理后台。  
4. `apps/desktop-ui`：Tauri 前端（用户侧）。  
5. `apps/native-core`：Rust Native Core（建议按 crate 切分）。  
6. `packages/contracts-openapi`：OpenAPI 规范与生成客户端。  
7. `packages/contracts-ipc`：Tauri IPC 命令/事件 schema。  
8. `packages/contracts-events`：Queue payload schema（JSON Schema + TS types）。  
9. `packages/shared-types`：跨端错误码、枚举、DTO。  
10. `infra/docker`：docker-compose、Dockerfile、Nginx 配置、部署脚本。  
11. `infra/db/migrations`：SQL migration（按批次）。  
12. `infra/ci`：GitHub Actions / Jenkins pipeline 定义。  
13. `docs/adr`：关键架构决策记录（边界、锁模型、回滚策略）。

### C2. 模块边界（关键）
1. Backend 不直接扫描本地路径。  
2. Native 不自行决定模板 revision。  
3. Worker 不接受前端直连。  
4. Admin 只能走 `/api/admin/*`。  
5. Desktop 只能走 `/api/desktop/*` + IPC。

---

## D. 数据库实施方案（migration、DDL、索引、约束、幂等、锁、审计）

### D1. Migration 分批计划（必须顺序）
1. `M001_extensions`：`vector`、`pg_trgm`、基础 enum/check。  
2. `M002_iam_org`：`user/department/role/permission/user_role/role_permission`。  
3. `M003_skill_review`：`skill/skill_version/skill_category/skill_tag/skill_tag_rel/skill_permission_rule/review_task`。  
4. `M004_tool_template`：`ai_tool_catalog/ai_tool_install_target_template/ai_tool_detection_rule`。  
5. `M005_device_workspace`：`client_device/tool_instance/workspace_registry`。  
6. `M006_install_governance`：`install_record/install_ticket/local_install_binding/skill_usage_event`。  
7. `M007_search_indexes`：`skill_search_profile/skill_document` + HNSW/GIN 索引。  
8. `M008_audit_seed`：`audit_log` + 首批工具模板 seed。  
9. `M009_constraints_finalize`：部分唯一索引、幂等索引、历史数据回填与校验脚本。

### D2. DDL 要点
1. `install_ticket` 新增：`consume_mode VARCHAR(32) NOT NULL DEFAULT 'one_time'`，`retry_token VARCHAR(128)`。  
2. `install_record` 新增：`status_version INT NOT NULL DEFAULT 0`，`operation_seq BIGINT NOT NULL DEFAULT 1`。  
3. `skill_version` 保持 `stage1_index_status/stage2_index_status/search_ready_at`。  
4. `ai_tool_install_target_template` 维持 revision 不可变，不允许覆盖旧 revision。  
5. `local_install_binding` 保留 `state(active/removed/drifted)`，禁止硬删除覆盖历史。

### D3. 索引与唯一约束
1. `install_record`：`idx_install_record_lock_key(lock_key)`，`idx_install_record_user_created(user_id, created_at desc)`，`idx_install_record_trace(trace_id)`。  
2. 幂等唯一：`UNIQUE(source_client_id, operation_type, idempotency_key)`（`idempotency_key IS NOT NULL`）。  
3. `install_ticket`：`idx_ticket_record_status(install_record_id, status)`，`idx_ticket_user_device(user_id, client_device_id)`。  
4. `local_install_binding`：部分唯一 `UNIQUE(client_device_id, resolved_target_path) WHERE state='active'`。  
5. `ai_tool_install_target_template`：  
6. `UNIQUE(tool_id, template_code, template_revision, os_type)`。  
7. 部分唯一：`UNIQUE(tool_id, os_type, scope_type, artifact_type) WHERE is_default=true AND release_status='active'`。  
8. `skill_search_profile`：GIN(`keyword_document gin_trgm_ops`) + HNSW(`head_embedding vector_cosine_ops`)。  
9. `skill_document`：`idx_doc_version(skill_version_id, chunk_index)` + HNSW(`embedding vector_cosine_ops`)。

### D4. 幂等键与锁键
1. 幂等键作用域：`user_id + client_device_id + operation_type + skill_id + tool_instance_id + target_scope + workspace_registry_id`。  
2. 24h 内同键返回同一 `install_record`。  
3. 锁键：`lock_key = sha256(client_device_id + ':' + resolved_target_path)`。  
4. 双层锁：Redis 锁（TTL 120s + 续约）+ PostgreSQL advisory lock（事务级）。

### D5. 审计字段规范
1. 核心表统一：`created_at/created_by/updated_at/updated_by`。  
2. 链路追踪统一：`trace_id/source_ip/source_client_id`。  
3. `audit_log` 必填：`actor_user_id/action/resource_type/resource_id/payload_json/ip/created_at`。

---

## E. API 与协议实施方案（OpenAPI / IPC / Worker 事件）

### E1. OpenAPI 分域与鉴权
1. `/api/admin/*`：JWT + 角色校验。  
2. `/api/desktop/*`：JWT + 设备归属校验。  
3. `/api/native/*`：JWT + `X-Device-Token` + ticket 三重绑定。  
4. `/api/internal/*`：服务账号（mTLS 或内网签名 token）。

### E2. 核心接口（v1 固化）
1. `POST /api/desktop/install-tickets`：申请票据。  
2. `GET /api/native/install-tickets/{ticketId}/manifest`：拉取 manifest。  
3. `POST /api/native/install-tickets/{ticketId}/consume`：阶段推进。  
4. `POST /api/native/install-operations/{installRecordId}/report`：终态上报。  
5. `POST /api/desktop/search/skills`：搜索。  
6. `POST /api/admin/ai-tool-templates`：模板发布（revision 不可变）。

### E3. 错误码与响应
1. 错误码分层：`AUTH_* / PERM_* / INSTALL_* / TICKET_* / SEARCH_* / INDEX_*`。  
2. 统一响应：`{ code, message, requestId, traceId }`。  
3. 状态冲突必须返回 409，阶段乱序返回 412。

### E4. IPC 契约（Desktop UI <-> Native）
1. Commands：`scan_tools`, `select_workspace`, `preview_install_target`, `apply_install_ticket`, `upgrade_installation`, `uninstall_installation`, `rollback_installation`, `verify_installation`, `list_local_installs`。  
2. Events：`install.progress`, `install.stage_changed`, `install.finalized`, `scan.finished`, `registry.changed`。  
3. 每个事件强制携带：`installRecordId`, `ticketId`, `traceId`, `stage`, `timestamp`。

### E5. Worker 事件契约（Queue）
1. `Stage1IndexJob`：`{ jobId, skillVersionId, traceId, retry }`。  
2. `Stage2IndexJob`：`{ jobId, skillVersionId, chunkPolicy, traceId }`。  
3. `SearchAssembleJob`：`{ requestId, userId, query, permissionDigest, candidateIds }`。  
4. `ReconcileJob`：`{ clientDeviceId, installRecordId, reason, traceId }`。  
5. Schema 管理：JSON Schema + 版本号 + 向后兼容检查（CI 强制）。

---

## F. 安装治理实施方案（时序、补偿、并发）

### F1. install 时序（标准）
1. Desktop 申请 ticket（含 idempotencyKey）。  
2. Backend 校验权限/模板可用性/设备绑定，写 `install_record + install_ticket`（`ticket_issued`）。  
3. Native 拉取 manifest。  
4. Native 下载至 staging。  
5. Native 执行 checksum + signature。  
6. Native 解析模板变量得到 `resolved_target_path`。  
7. Native 申请锁（Redis -> PG advisory lock）。  
8. Native 原子落盘（tmp + fsync + rename/swap）。  
9. Native 更新本地 SQLite 注册表事务。  
10. Native 回传终态；Backend 更新 `local_install_binding` 与审计。  
11. 释放锁并标记 ticket 消费状态。

### F2. upgrade 时序
1. 读取 active binding 与本地注册表。  
2. 校验权限仍有效、模板可升级、版本兼容。  
3. 创建快照（文件备份或目录 hash 清单）。  
4. 执行 install 新版本。  
5. verify 失败自动 rollback；成功则切换 active binding。

### F3. uninstall 时序
1. 定位托管对象。  
2. `directory` 模式删除托管目录；`managed_block` 模式仅删受管块。  
3. 注册表更新 + `local_install_binding.state='removed'`。  
4. 保留历史 install_record。

### F4. rollback 时序
1. 触发：verify 失败或用户主动回滚。  
2. 从最近快照恢复。  
3. 恢复后 verify。  
4. 生成新的 rollback install_record。  
5. 更新 active binding 指针。

### F5. 失败补偿与并发
1. 下载失败：指数退避最多 3 次。  
2. 校验失败：禁止 commit，直接失败或回滚。  
3. 回执失败：本地离线队列重试上报。  
4. 服务端-本地漂移：`ReconcileJob` 自动修复。  
5. 同一 `lock_key` 只允许单活跃操作；冲突返回 `409_INSTALL_CONFLICT`。

---

## G. 搜索实施方案（stage1/stage2、权限、缓存、降级、观测）

### G1. Stage1
1. Query Rewrite（规则优先，模型可选）。  
2. 生成权限 SQL 约束（可见 + 可用 + 非 deny）。  
3. 在 `skill_search_profile` 执行三路召回：向量、关键词、规则。  
4. 合并去重得到 top 50-100。

### G2. Stage2
1. 仅在候选 skill_version 集合内检索 `skill_document`。  
2. 抽取 top chunk 生成 `whyMatched evidence`。  
3. 规则重排（权限匹配、工具兼容、评分、活跃度）。  
4. LLM 后置整理 top 5-10，禁止引入候选外结果。

### G3. 权限过滤落点
1. 必须在 Stage1 前执行 SQL 级过滤。  
2. 明确禁止“先全量召回再过滤”。

### G4. 缓存
1. Query Rewrite：60s。  
2. Stage1 候选：30s。  
3. 最终结果：30s。  
4. Key 强制包含 `permission_digest`；角色变更即时失效。

### G5. 降级
1. Stage2 不可用：返回 Stage1（`degraded_reason=stage2_unavailable`）。  
2. LLM 不可用：返回规则重排（`llm_unavailable`）。  
3. 向量不可用：关键词+规则兜底（`vector_unavailable`）。

### G6. 观测指标（必须落监控）
1. `search_p95_ms`。  
2. `prefilter_hit_ratio`。  
3. `stage2_timeout_rate`。  
4. `llm_degrade_rate`。  
5. `permission_mismatch_incident_count`（应为 0）。  
6. `topk_ctr` 与 `whyMatched_click_ratio`。

---

## H. 工具路径模板实施方案（Windows）

### H1. 状态策略
1. `verified`：可默认推荐、可生产下发。  
2. `candidate`：可见不可默认，仅灰度白名单。  
3. `deprecated`：禁止新安装，仅用于迁移。

### H2. 首批模板与状态
1. Cursor 项目规则 `${workspaceRoot}/.cursor/rules/${skillKey}.mdc`：`verified`。  
2. Cursor 项目 `AGENTS.md` 受管块：`candidate`，需要 Windows 真机验证。  
3. Cline 项目技能目录 `${workspaceRoot}/.cline/skills/${skillKey}/SKILL.md`：`candidate`，需要 Windows 真机验证。  
4. Cline `.clinerules` 受管块：`candidate`，需要 Windows 真机验证。  
5. Cline 全局目录 `${userHome}/.cline/skills/${skillKey}/SKILL.md`：`candidate`，需要 Windows 真机验证。  
6. OpenCode 项目目录 `${workspaceRoot}/.opencode/skills/${skillKey}/SKILL.md`：`verified`。  
7. OpenCode 全局目录 `${userHome}/.config/opencode/skills/${skillKey}/SKILL.md`：`candidate`，需要 Windows 真机验证。  
8. OpenCode 兼容目录 `${workspaceRoot}/.agents/skills/${skillKey}/SKILL.md`：`candidate`（非主路径）。  
9. Codex 项目 `AGENTS.md` 受管块：`candidate`，需要 Windows 真机验证。

### H3. 验证前提（candidate -> verified）
1. 真实工具版本矩阵覆盖（至少当前稳定版与前一版）。  
2. install/upgrade/uninstall/rollback 全流程通过。  
3. 受管块冲突测试通过（块内改动、块外改动）。  
4. 权限回收后不可继续安装。  
5. 回滚后工具可正常识别生效。

---

## I. 测试与 CI/CD 实施方案

### I1. 环境策略
1. macOS：Backend/Admin/Desktop UI/Mock Native 开发。  
2. Windows 真机：Native Core、路径解析、安装生命周期验证。  
3. Linux：Nginx + Backend + Worker + Redis + PostgreSQL + MinIO 部署验证。

### I2. Contract Test
1. OpenAPI Contract：Admin/Desktop/Native。  
2. IPC Contract：Tauri command/event。  
3. Queue Contract：IndexJob/InstallEvent/ReconcileEvent。  
4. 规则：契约变更先改 schema，再改实现，再更新客户端。

### I3. CI 矩阵
1. Linux Runner：lint、unit、integration、migration check、search pipeline。  
2. Windows Runner：native unit、模板解析、工具扫描、install/upgrade/uninstall/rollback E2E。  
3. 必须门禁：`search_permission_prefilter_test`、`install_lifecycle_e2e_windows`、migration backward-compat。

### I4. CD 与部署
1. Backend/Worker/MinIO 使用 Docker 镜像发布。  
2. Nginx 作为入口反向代理与静态资源托管。  
3. PostgreSQL 建议主机托管 + 物理卷备份；测试环境可 Docker。  
4. Windows 客户端产出 MSI/EXE，内网升级源灰度发布。

---

## J. 项目执行计划（P0/P1/P2，依赖、负责人、工期、交付物、DoD）

### J1. P0（阻塞，必须先做）
1. 契约冻结（OpenAPI+IPC+Queue）；依赖：无；负责人：架构负责人+后端负责人+桌面负责人；工期：4 天；交付物：版本化契约仓；DoD：评审签字且 CI 契约检查通过。  
2. 安装治理核心 migration；依赖：契约冻结；负责人：后端+DBA；工期：3 天；交付物：M006；DoD：安装链路表与索引全部上线。  
3. 模板治理三表 migration + seed；依赖：无；负责人：后端+平台工具负责人；工期：3 天；交付物：M004+M008 seed；DoD：模板可按 revision 发布。  
4. 搜索两阶段 migration + 向量索引；依赖：无；负责人：搜索负责人+DBA；工期：3 天；交付物：M007；DoD：stage1/stage2 写入可用。  
5. 权限前置过滤 SQL 生成器；依赖：IAM/skill_permission_rule；负责人：后端；工期：4 天；交付物：search prefilter module；DoD：先过滤后召回测试通过。  
6. 安装双层锁实现（Redis+PG advisory）；依赖：M006；负责人：后端+Native；工期：3 天；交付物：lock service；DoD：并发冲突稳定返回 409。  
7. Native staging + 原子落盘 + SQLite 注册表事务；依赖：契约冻结；负责人：Native；工期：6 天；交付物：installer/registry crate；DoD：断电模拟不破坏目标文件。  
8. Worker stage1/stage2 pipeline；依赖：M007；负责人：搜索负责人；工期：5 天；交付物：IndexJob pipeline；DoD：状态机推进正确。  
9. Windows 真机自动化回归基线；依赖：Native 核心能力；负责人：QA 自动化；工期：4 天；交付物：E2E 脚本；DoD：install lifecycle 全通过。

### J2. P1（核心能力）
1. install/upgrade/uninstall/rollback 全状态机与补偿；依赖：P0-2/6/7；负责人：后端+Native；工期：8 天；交付物：完整生命周期；DoD：四操作 E2E 通过。  
2. 模板 revision 不可变发布与默认模板切换；依赖：P0-3；负责人：后端+Admin；工期：4 天；交付物：模板管理页+API；DoD：不可覆盖旧 revision。  
3. 设备注册/撤销/心跳；依赖：P0-1；负责人：后端+Desktop；工期：4 天；交付物：device trust 模块；DoD：撤销设备后票据拉取失败。  
4. 多轮审核流与审计；依赖：M003；负责人：后端+Admin；工期：5 天；交付物：review_round 流程；DoD：同人回避规则有效。  
5. 搜索三路混合召回 + LLM 后置；依赖：P0-4/5/8；负责人：搜索负责人；工期：7 天；交付物：search service v1；DoD：降级与命中解释可用。  
6. ReconcileJob 对账修复；依赖：install lifecycle；负责人：后端+Worker；工期：4 天；交付物：对账任务；DoD：状态漂移可自动收敛。

### J3. P2（增强）
1. 搜索缓存与失效细化；依赖：P1-5；负责人：搜索；工期：3 天；交付物：缓存策略上线；DoD：性能指标达标。  
2. 排行榜与搜索联动；依赖：usage event；负责人：后端+搜索；工期：3 天；交付物：重排权重；DoD：可配置且可观测。  
3. candidate 模板灰度控制台；依赖：模板治理；负责人：Admin；工期：3 天；交付物：白名单控制；DoD：灰度策略生效。  
4. 统一可观测性面板；依赖：日志与指标埋点；负责人：SRE；工期：4 天；交付物：Grafana 面板；DoD：安装成功率/回滚率/搜索降级率可视。

---

## K. 风险与回退预案（高/中/低）

### K1. 高风险
1. 受管块误改用户文件。  
触发：升级/卸载后用户文件异常。  
动作：立刻停止 candidate 模板下发；启用快照恢复；仅保留 verified 模板。  
2. ticket 重放或跨设备消费。  
触发：同 ticket 多设备消费告警。  
动作：强制吊销 ticket，封禁设备 token，审计追踪并回收 install_record。  
3. Windows 路径差异导致大面积失败。  
触发：同模板失败率连续 15 分钟 >5%。  
动作：模板自动降级为 candidate 并撤回默认推荐；回滚至上一 revision。

### K2. 中风险
1. CPU-only 向量化吞吐不足。  
触发：stage2 索引队列堆积 > 1000。  
动作：切换低峰批处理、降低 chunk 并发、优先 stage1 可搜。  
2. 权限缓存不一致。  
触发：权限变更后 60s 内仍可搜索旧结果。  
动作：主动失效 permission_digest 相关 key；触发全量 refresh。  
3. 回执丢失引发状态漂移。  
触发：终态上报失败重试超过阈值。  
动作：本地离线队列重放 + ReconcileJob 补偿。

### K3. 低风险
1. 热门技能挤压长尾。  
触发：前 20 结果过度集中。  
动作：排行榜权重上限 + 多样性重排。  
2. 审核吞吐不足。  
触发：审核 SLA 超标。  
动作：按部门分配 reviewer + 批量操作入口。

---

## L. 开工清单（按优先级，含阻塞）

1. 【阻塞】冻结 OpenAPI/IPC/Queue schema 并完成跨组评审签字。  
2. 【阻塞】建立 migration 仓与命名规范，落地 M001-M009 脚手架。  
3. 【阻塞】先执行 M004/M006/M007（模板、安装、搜索核心表）。  
4. 【阻塞】实现 `install_ticket.consume_mode + retry_token` 全链路。  
5. 【阻塞】实现权限前置过滤 SQL 生成器并接入搜索入口。  
6. 【阻塞】实现 Redis 锁 + PG advisory lock 与冲突返回规范。  
7. 【阻塞】Native 完成 staging、原子落盘、SQLite 事务注册表。  
8. 【阻塞】Worker 打通 stage1/stage2 索引流水线与状态机。  
9. 【阻塞】搭建 Windows 真机 CI Runner 并接入 install lifecycle E2E。  
10. 初始化 `ai_tool_catalog` 与首批模板 seed（含 verified/candidate 状态）。  
11. 完成 Desktop `install ticket` 申请与进度展示链路。  
12. 完成 Native `manifest->consume->report` 三接口闭环。  
13. 完成模板发布后台（revision 不可变 + 默认模板切换）。  
14. 完成设备注册、设备撤销、设备心跳。  
15. 完成 install/upgrade/uninstall/rollback 全生命周期接口与状态推进。  
16. 完成受管块协议实现与冲突保护（AGENTS.md/.clinerules）。  
17. 建立 ReconcileJob 并加入夜间对账任务。  
18. 上线可观测性指标与告警阈值（安装失败率、回滚率、搜索降级率）。

---

## 默认假设（已锁定）
1. 采用 Monorepo；若后续拆仓，不改变契约仓与 migration 仓结构。  
2. 生产应用层容器化，PostgreSQL 主机托管优先。  
3. 首发生产默认模板仅 `verified`；所有 `candidate` 先做 Windows 真机验证。  
4. 所有安装行为必须有 `install_record` 与 `audit_log`，无例外路径。
