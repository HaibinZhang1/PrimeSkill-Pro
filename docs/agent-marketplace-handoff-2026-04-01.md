# Agent Marketplace 当前方案总结与交接

## 1. 项目目标

构建一个企业内网部署的 Agent Skills 管理市场，解决企业内部 AI Skill 的共享、发布审核、权限控制、智能检索和本地多环境安装问题。

运行环境约束：

- 服务端：Linux + Nginx + PostgreSQL
- 用户端：主要是 Windows
- 开发环境：主要是 macOS
- 规模预估：500-3000 用户，1 万级 Skill

## 2. 当前已确定的核心方向

### 2.1 技术路线

当前已选定主技术路线为：

- 前后端主栈：TypeScript
- 服务端：NestJS
- 数据库：PostgreSQL
- 向量检索：pgvector
- 队列与缓存：Redis
- 文件包存储：MinIO 或 Linux 文件存储

### 2.2 架构方向的演进

最初方案是：

- Web Portal + Backend + Search Worker + Windows Local Daemon

但在进一步讨论后，用户提出：

- 如果必须依赖桌面 Daemon 来做本地扫描与一键安装，那么普通用户侧可以不再需要 Web 页面，而是直接整合成桌面程序

因此当前收敛出的方向是：

- 普通用户端：桌面客户端一体化
- 服务端：统一 Linux 后端
- 管理端：是否继续保留 Web 管理后台，尚未最终确认

当前推荐但尚未最终确认的形态是：

1. 普通用户使用桌面客户端
2. 管理员使用 Web 管理后台
3. Linux 服务端统一提供 API、权限、检索、审核、统计能力

## 3. 当前推荐的总体架构

### 3.1 普通用户侧

推荐使用桌面客户端一体化方案：

- `Tauri + React + Rust Core`

桌面客户端负责：

- 登录
- Skill 搜索与浏览
- 收藏、评分
- 本地 AI 工具扫描
- 一键安装/卸载
- 项目目录选择
- 本地安装记录管理

这样做的好处：

- 不再需要浏览器通过 localhost 去调本地 Daemon
- 减少本地通信安全面
- 用户体验更连贯
- 更适合“扫描本地路径 + 直接写本地文件”的核心需求

### 3.2 服务端

服务端保持不变，继续采用：

- `Nginx + NestJS + PostgreSQL + Redis + MinIO`

服务端负责：

- 身份认证
- LDAP/SSO 预留
- RBAC 权限控制
- Skill 元数据管理
- Skill 发布与审核
- 检索与推荐
- 排行榜与数据看板
- 安装包下发
- 审计日志

### 3.3 检索层

推荐保留独立 Search / Index Worker：

- 负责 Skill 文本抽取
- 负责切片与 embedding
- 负责混合召回与重排

原因：

- embedding 和索引构建是 CPU 密集型任务
- 将检索管线独立出来更利于服务端稳定性

## 4. 身份认证与权限模型

### 4.1 用户类型

目前已明确存在两类用户：

- 普通用户
- 管理员用户

管理员用户还存在部门边界：

- 管理员属于某个部门
- 可以管理本部门及子部门下的 Skill、用户与审核任务

### 4.2 推荐角色模型

推荐角色：

- `platform_admin`：全局平台管理
- `security_admin`：权限与审计
- `dept_admin`：仅管理本部门及子部门资源
- `reviewer`：审核 Skill
- `normal_user`：普通用户

### 4.3 权限设计原则

采用：

- 平台级 RBAC
- Skill 级资源授权
- 部门范围作用域

推荐通过 `user_role(scope_type, scope_ref_id)` 表达范围：

- `scope_type=global`
- `scope_type=department`
- `scope_type=personal`

Skill 级权限继续通过 `skill_permission_rule` 控制：

- `view`
- `use`
- `manage`

支持：

- 公开
- 指定部门
- 私有
- 显式 allow / deny

## 5. Skill 生命周期

### 5.1 主要流程

1. 用户上传 Skill 包
2. 保存 Skill 与 Skill Version
3. 发起审核
4. 审核通过后发布
5. 异步进入索引流程
6. 可被搜索、收藏、安装、统计

### 5.2 平台需要支持的能力

- 草稿
- 提交审核
- 审核通过/拒绝
- 发布
- 归档
- 多版本管理

## 6. 搜索与 RAG 方案

### 6.1 已经确认的关键原则

搜索必须采用：

- 权限前置过滤
- 混合召回
- LLM 后置整理

不能采用：

- 先全库召回，再事后删掉无权限结果

### 6.2 两阶段索引

当前结论是不建议只对标题做向量化。

推荐采用两阶段索引：

1. 即时索引层
   - 对 `标题 + 摘要 + 标签 + 分类 + 适配工具 + 审核标签` 生成轻量 embedding
   - 目标是上传后快速可搜

2. 深度索引层
   - 对 README、Prompt、Manifest、示例用法做分块 embedding
   - 目标是提升自然语言语义召回质量

### 6.3 为什么不只做标题向量化

原因：

- Skill 名称往往不足以表达真实能力
- 长尾 Skill 容易漏召回
- 用户自然语言查询常常对应 README/Prompt 中的信息而不是标题

因此“只标题向量化”可以作为第一阶段降本策略，但不应是最终方案。

### 6.4 检索流程

建议流程：

1. 用户输入自然语言查询
2. 系统做 query rewrite 或规则抽取
3. 后端先构造权限过滤条件
4. 检索层在权限范围内执行：
   - 向量召回
   - 关键词召回
   - metadata/热度召回
5. 规则重排
6. LLM 对候选结果做解释与推荐输出

## 7. 本地安装与路径管理

### 7.1 关键判断

此前提出过统一项目目录 `.agentskills` 的建议，但后续已修正：

- 不应强制统一项目级路径
- 不同 AI 工具对项目级 Skill/Rule/Instruction 的读取路径不同

因此当前结论是：

- 安装路径必须按 AI 工具区分
- 默认路径必须配置在数据库表中，便于后续维护

### 7.2 安装目标必须由用户选择

用户安装 Skill 时，需要先选择目标 AI 工具，例如：

- Cursor
- Cline
- OpenCode
- Codex

然后再选择：

- 安装到全局
- 安装到项目

最终由本地客户端根据工具模板解析真实路径。

### 7.3 工具路径模板表

当前已明确应该新增如下表：

#### ai_tool_catalog

- tool_code
- tool_name
- vendor
- official_doc_url
- supported_os_json

#### ai_tool_install_target_template

- tool_id
- artifact_type
- scope_type
- target_path_template
- packaging_mode
- filename_template
- min_tool_version
- max_tool_version
- is_default
- source_reference_url

#### ai_tool_detection_rule

- tool_id
- os_type
- detection_type
- rule_expr
- expected_install_path
- expected_config_path
- expected_target_path

### 7.4 这个设计的价值

- 新增工具或修正路径时不必改客户端代码
- 支持不同工具版本的路径差异
- 支持全局与项目两种不同安装协议
- 后台可集中维护路径规则

## 8. 浏览器插件方案结论

已经讨论过“是否可以采用纯 Web + 浏览器插件，不要 Windows Daemon”。

当前结论：

- 纯插件方案不足以替代本地原生组件

原因：

- 浏览器本身不能稳定扫描本地任意 AI 工具安装路径
- 浏览器本身不能无感写入任意本地目录
- 想做这类能力仍需要 Native Messaging 或本地原生 Helper

因此最终判断是：

- 如果要做“自动扫描 + 一键安装 + 项目目录选择”，本地原生组件基本不可避免

既然本地原生组件不可避免，那么普通用户端直接收敛成桌面客户端更合理。

## 9. 数据库设计结论

当前已识别的核心表包括：

- `user`
- `department`
- `role`
- `permission`
- `user_role`
- `role_permission`
- `skill`
- `skill_version`
- `skill_category`
- `skill_tag`
- `skill_tag_rel`
- `skill_permission_rule`
- `review_task`
- `skill_favorite`
- `skill_rating`
- `install_record`
- `tool_instance`
- `workspace_registry`
- `daemon_device`
- `audit_log`
- `skill_document`
- `ai_tool_catalog`
- `ai_tool_install_target_template`
- `ai_tool_detection_rule`

其中重点是：

- `skill_permission_rule`：控制 Skill 的 view/use/manage
- `tool_instance`：记录某用户设备上发现的 AI 工具实例
- `workspace_registry`：记录项目级安装目标
- `skill_document`：承载 RAG 的切片与向量
- `ai_tool_install_target_template`：承载不同工具的默认路径规则

## 10. 跨平台开发与测试方案

### 10.1 开发环境

当前约束：

- 开发机是 macOS
- 服务端部署是 Linux
- 用户端运行是 Windows

### 10.2 推荐研发方式

1. 服务端在 macOS 上开发
   - 使用 Docker Compose 拉起 PostgreSQL / Redis / MinIO

2. 桌面客户端做分层
   - `core`：通用安装逻辑、协议、manifest 处理
   - `windows_adapter`：Windows 路径扫描、注册表、原生文件选择器
   - `mock_adapter`：macOS 本地开发联调

3. CI 必须增加 Windows Runner
   - 跑真实路径扫描测试
   - 跑安装/卸载集成测试
   - 跑工具路径模板解析测试

### 10.3 结论

macOS 可用于主开发，但不能替代 Windows 集成测试。

必须建立：

- mock 层
- contract test
- Windows CI runner

## 11. 当前最大的未决问题

以下问题在当前 session 结束时还没有完全定稿：

1. 管理端是否保留 Web 后台
   - 推荐保留
   - 但用户尚未最终确认

2. 普通用户桌面客户端的最终形态
   - 倾向：`Tauri + React + Rust`
   - 尚未进一步细化模块拆分

3. 第一批支持的 AI 工具清单
   - 已讨论 Cursor / Cline / OpenCode / Codex
   - 但还没有形成正式初始化模板数据

4. 管理端与桌面客户端的 API 边界
   - 还未详细展开

5. 完整数据库建表 SQL
   - 尚未输出

## 12. 下一步最适合继续的工作

建议下一个 session 继续做以下内容之一：

### 路线 A：重构完整架构方案

把当前设计文档正式重写为“桌面客户端 + 服务端 + 管理后台”的最终版本，包括：

- 新架构图
- 模块边界
- 用户端与管理端职责
- 本地 IPC 通信替代 localhost 通信

### 路线 B：落数据库与 API

基于当前结论继续细化：

- PostgreSQL 建表 SQL
- API 清单
- 权限判断逻辑
- 工具路径模板表示例数据

### 路线 C：先做工具路径模板专项设计

围绕不同 AI 工具的全局与项目路径，补齐：

- 工具路径模板初始化数据
- 安装协议设计
- 卸载/升级/回滚策略
- 工具适配优先级

## 13. 建议给下一 session 的工作目标

建议下一 session 先完成：

- 将现有方案正式重构成“桌面客户端 + Linux 服务端 + 可选 Web 管理后台”的最终架构文档
- 同时产出数据库 ER 最终版
- 并给出首批 AI 工具路径模板初始化数据

## 14. 可直接复制给下一 session 的提示词

下面这段提示词可以直接发给下一个 session：

```text
请继续基于当前已有方案推进企业内网 Agent Skills 管理市场的设计。

当前已经确认的前提如下：

1. 目标是内网部署的 Agent Skills 管理与分发平台。
2. 服务端部署在 Linux，使用 Nginx + NestJS + PostgreSQL + Redis + MinIO。
3. 用户主要是 Windows 用户。
4. 开发环境主要是 macOS，需要考虑跨平台开发和测试。
5. 规模预估为 500-3000 用户、1 万级 Skill。
6. 由于本地扫描路径和一键安装能力强依赖本地原生组件，普通用户端不再优先采用 Web + Daemon，而是倾向整合成桌面客户端。
7. 当前倾向方案是：普通用户使用桌面客户端；管理员可能继续使用 Web 管理后台，但这一点还可以继续评估。
8. 搜索方案已经明确：不能只依赖标题向量化，推荐使用“两阶段索引”：
   - 第一阶段：标题 + 摘要 + 标签 + 分类 + 适配工具的轻量 embedding
   - 第二阶段：README / Prompt / Manifest / 示例的分块 embedding
9. 搜索必须采用“权限前置过滤 + 混合召回 + LLM 后置整理”。
10. 不同 AI 工具的 Skill 路径不一致，不能统一写入 `.agentskills`，必须引入数据库表维护工具路径模板。
11. 数据库中应包含 `ai_tool_catalog`、`ai_tool_install_target_template`、`ai_tool_detection_rule` 等路径模板相关表。
12. 已讨论过的关键工具包括 Cursor、Cline、OpenCode、Codex，但还没有形成最终模板初始化数据。

请你接下来完成以下任务：

1. 把当前方案正式重构为“桌面客户端 + Linux 服务端 + 管理后台”的最终架构方案。
2. 输出新的系统架构说明，明确：
   - 桌面客户端的模块边界
   - 服务端的模块边界
   - 管理后台是否保留 Web，并给出建议
   - 桌面客户端与服务端如何通信
   - 桌面客户端内部 UI 与本地安装核心如何通过 IPC 通信
3. 输出最终版数据库 ER 设计，覆盖：
   - 用户、部门、角色、权限
   - Skill、Version、审核、评分、收藏
   - 路径模板表
   - 工具实例、工作区、安装记录
4. 继续细化安装体系，重点设计：
   - 全局安装
   - 项目安装
   - 工具路径模板解析
   - 安装、升级、卸载、回滚
5. 给出第一批 AI 工具的路径模板初始化建议，至少覆盖：
   - Cursor
   - Cline
   - OpenCode
   - Codex
6. 单独说明 macOS 开发、Windows 客户端测试、Linux 服务端部署的协作方式。

请基于以上前提直接继续输出完整方案，不要从头重复讨论是否需要 Daemon，而是从“桌面客户端一体化”这个新方向往下推进。
```
