# PrimeSkill Pro 当前任务快照

更新时间：2026-04-03

## 1. 当前阶段定义

当前主目标：

- 把项目从“项目级安装闭环 PoC”推进到“Phase 1 最小可用 MVP”。

本阶段边界：

- 不重做已完成的 Cursor / OpenCode project install loop。
- 不把 Phase 2 / Phase 3 功能混入主目标。
- 不把 `Cline` / `Codex` / `global` 安装直接纳入生产默认。

## 2. 仓库事实判断

### 2.1 已完成且已落在仓库中的能力

- [x] `M001-M009` 数据库 migrations 已完成。
- [x] Backend 已有：
  - `skills`
  - `install`
  - `runtime`
  - `search`
  - `templates`
- [x] Desktop 已完成 runtime sync：
  - `client_device`
  - `tool_instance`
  - `workspace_registry`
- [x] install ticket 主链路已落地。
- [x] Native Core 已具备本地：
  - install
  - uninstall
  - rollback
  - verify
- [x] `local_install_binding` 已落地。
- [x] `GET /api/my/installs` 已落地，“我的安装”页面可回读后端状态。
- [x] 主链路已跑通：
  - project scope only
  - verified templates only
  - Cursor / OpenCode

### 2.2 本 session 新增完成

- [x] Native Core 已支持真实 zip artifact 解包执行，并继续兼容旧的 `prime_skill_package.v1` JSON 包。
- [x] 已新增 Phase 1 安装 contract / artifact 约束文档：
  - `docs/adr/0004-phase1-install-contract.md`
- [x] README 已同步 artifact 能力现状。
- [x] Desktop UI 与 admin-web 已完成首批“中文优先”文案清理。

### 2.3 仍未完成或仍为 PoC 的部分

- [ ] admin-web 仍是骨架，未形成最小可用发布/审核后台。
- [ ] 搜索仍保留 `demo_catalog` fallback，数据库为空时会回退。
- [ ] 后端真实 artifact 构建 / 发布 / 样例数据链路未完成。
- [ ] 当前 package 模型仍是 Phase 1 最小实现，没有完整对象存储与 provenance 治理。
- [ ] `Cline` / `Codex` / `global` 仍未进入生产默认，只应作为 Windows 真机 PoC。
- [ ] browser preview 仍不能执行本地安装。
- [ ] OpenAPI / IPC contract 尚未从代码内聚为正式发布物，只完成了 Phase 1 约束冻结。

## 3. 当前生产默认范围

仅以下范围可以视为当前生产默认：

- project scope
- verified templates
- Cursor `cursor_project_rule`
- OpenCode `opencode_project_skill`

以下范围暂不进入生产默认：

- `Cline`
- `Codex`
- `global` 安装
- candidate 模板

## 4. Phase 1 P0 / P1 / P2 计划

### 4.1 P0

- [ ] 用真实 artifact 替换 placeholder 发布方式，打通：
  - `skill_version.package_uri`
  - artifact fetch
  - checksum verify
  - native apply
- [ ] 补最小 Skill 发布 / 审核 / 发布后入索引链路：
  - Skill 列表
  - Skill 详情
  - 版本创建
  - 审核队列
  - 审批动作
- [ ] 把搜索主路径切到真实数据库，`demo_catalog` 仅保留为 dev fallback 或显式开关。
- [ ] 冻结并沉淀 Backend / Desktop / Native Core 的正式 contract 产物。
- [ ] 继续清理 Desktop / Admin Web 的英文用户文案，保持简体中文优先。

### 4.2 P1

- [ ] 做 Windows 真机 smoke：
  - Cursor project verified
  - OpenCode project verified
  - install / uninstall / rollback / verify
- [ ] 做 `Cline` / `Codex` / `global` 的 Windows 真机 PoC。
- [ ] 增补 contract fixture test，确保 Backend manifest、Desktop IPC、Native parser 对同一份样例一致。

### 4.3 P2

- [ ] 补 admin-web 只读信息与最小运营辅助页面。
- [ ] 补中文化扫尾与交互提示统一。
- [ ] 补 README / task / verification docs 的阶段性同步。

## 5. 当前最推荐的下一刀

下一刀优先级：

1. 后端真实 artifact 发布 / 样例数据链路
2. admin-web 最小 Skill 发布 / 审核页面
3. 搜索切真实数据库并弱化 `demo_catalog`

原因：

- install 主链路本身已通，当前最大缺口不是“如何安装”，而是“平台如何稳定地产出可安装内容”。
- 如果不先补后台发布与样例数据，artifact 支持虽然已经到位，但仍缺可持续输入。

## 6. 文案与语言约束

必须继续遵守：

- 技术字段、数据库字段、API 字段名可以保留英文。
- 用户可见文案默认使用简体中文。
- 新页面、新弹窗、新按钮默认不得新增英文 UI。

## 7. 接手前应先读

- `README.md`
- `docs/adr/0004-phase1-install-contract.md`
- `docs/windows-verification-matrix.md`
- `docs/superpowers/specs/2026-04-01-agent-marketplace-design.md`
