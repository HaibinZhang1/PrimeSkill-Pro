# ADR 0004: Phase 1 安装 Contract 与 Artifact 约束

## 状态

已采纳

## 背景

PrimeSkill Pro 当前已经跑通 `project scope + verified templates + Cursor/OpenCode` 的安装闭环，但此前 Native Core 只稳定支持最小 JSON 包文档，真实 artifact 下载与解包能力不足，三端 contract 也主要分散在代码中。

为把项目推进到 Phase 1 最小可用 MVP，本 ADR 冻结本阶段安装链路的边界，避免 Backend、Desktop、Native Core 在并行开发中继续漂移。

## 决策

### 1. Phase 1 生产默认范围

- 生产默认只开放 `verified` 模板。
- 生产默认只开放 `project` scope。
- 生产默认工具只包含 `Cursor` 与 `OpenCode`。
- `Cline`、`Codex`、`global` 安装只做 Windows 真机 PoC，不进入生产默认。

### 2. 安装 Contract 冻结

本阶段安装链路 contract 以现有实现为准，代码锚点如下：

- Backend install DTO:
  - [apps/backend/src/modules/install/install.types.ts](G:/train/PrimeSkill-Pro/apps/backend/src/modules/install/install.types.ts)
- Backend manifest 生成:
  - [apps/backend/src/modules/install/install.service.ts](G:/train/PrimeSkill-Pro/apps/backend/src/modules/install/install.service.ts)
- Desktop Tauri IPC:
  - [apps/desktop-ui/src/tauri-client.ts](G:/train/PrimeSkill-Pro/apps/desktop-ui/src/tauri-client.ts)
  - [apps/desktop-ui/src-tauri/src/main.rs](G:/train/PrimeSkill-Pro/apps/desktop-ui/src-tauri/src/main.rs)
- Native Core manifest / apply / verify:
  - [apps/native-core/src/lib.rs](G:/train/PrimeSkill-Pro/apps/native-core/src/lib.rs)

本阶段不新增破坏式字段；若后续要扩展 `mediaType`、签名算法或多制品清单，必须以向后兼容方式追加。

### 3. Phase 1 支持的 artifact 形式

Native Core 必须支持两类 artifact：

- 兼容模式：`prime_skill_package.v1` JSON 包文档
- 生产推荐：zip artifact

zip artifact 规则：

- zip 内每个文件条目直接映射为一个安装 entry。
- 路径必须是相对路径，禁止绝对路径、空路径、`.`、`..` 与路径穿越。
- 默认忽略目录项、`__MACOSX/` 与 `.DS_Store`。
- 不要求 zip 内额外嵌套 package manifest。
- `single_file`、`directory`、`managed_block` 仍由 install manifest 中的模板元数据决定，不由 zip 自己声明。

### 4. Backend 对 artifact 的职责

- `skill_version.package_uri` 继续作为唯一制品地址来源。
- Backend install manifest 继续下发：
  - `package.uri`
  - `package.checksum`
  - `package.signature`
- Backend 在 Phase 1 不引入复杂对象存储编排；只要求 `package_uri` 可被 Native Core 拉取。

### 5. Native Core 对 artifact 的职责

- 先按 `package_uri` 拉取原始字节。
- 先校验 checksum，再解析 package。
- package 解析成功后，仍统一转为内部 `InstallPackageDocument` 执行落盘、卸载、回滚、校验。
- 本阶段 verify 仍以本地落盘结果校验为主，不做远端 artifact re-fetch。

### 6. 中文优先约束

- 面向用户的桌面端与管理端文案默认使用简体中文。
- API 字段名、数据库字段名、内部结构体字段名继续保留英文。
- 后续新增页面与按钮文案不得默认使用英文占位。

## 影响

### 正面影响

- 真实 artifact 下载/解包链路可以在不打断现有 PoC 主链路的前提下落地。
- Backend、Desktop、Native Core 可以围绕同一套 Phase 1 contract 并行推进。
- 为后续管理端最小发布链路补齐提供稳定边界。

### 已知限制

- 仍未引入完整对象存储、签名体系与企业级制品 provenance。
- 仍未把 `Cline`、`Codex`、`global` 安装纳入生产默认。
- 搜索链路与管理后台范围仍需按 Phase 1 继续补齐。
