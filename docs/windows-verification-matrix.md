# Windows 真机验证矩阵

更新时间：2026-04-03

## 1. 当前策略

生产默认只允许：

- verified templates
- project scope
- Cursor
- OpenCode

以下能力当前只允许作为 Windows 真机 PoC，不进入生产默认：

- `Cline`
- `Codex`
- `global` 安装
- candidate 模板

## 2. 当前仓库基线

- [x] Cursor project install loop 已在仓库主链路跑通。
- [x] OpenCode project install loop 已在仓库主链路跑通。
- [x] Native Core 已支持真实 zip artifact 与 legacy JSON package。
- [x] uninstall / rollback / verify 已在本地链路落地。
- [ ] 仍缺 Windows 真机回归记录与模板升级判定证据。

## 3. 验证矩阵

| Tool | Scope | Template | 当前状态 | 生产默认 | 必测项 |
|---|---|---|---|---|---|
| Cursor | project | `${workspaceRoot}/.cursor/rules/${skillKey}.mdc` | repo 已打通 | 是 | install / uninstall / rollback / verify / 生效验证 |
| OpenCode | project | `${workspaceRoot}/.opencode/skills/${skillKey}/SKILL.md` | repo 已打通 | 是 | install / uninstall / rollback / verify / 生效验证 |
| Cline | project | `${workspaceRoot}/.cline/skills/${skillKey}/SKILL.md` | 未做真机 PoC | 否 | 目录写入、升级替换、回滚恢复 |
| Cline | project | `${workspaceRoot}/.clinerules` managed_block | 未做真机 PoC | 否 | 受管块冲突、块内修改保护、卸载仅删块 |
| OpenCode | global | `${userHome}/.config/opencode/skills/${skillKey}/SKILL.md` | 未做真机 PoC | 否 | Windows 可写性、工具识别、权限一致性 |
| Codex | project | `${workspaceRoot}/AGENTS.md` managed_block | 未做真机 PoC | 否 | 受管块升级、卸载、回滚 |

## 4. 真机验证记录要求

每个待升级模板至少记录以下信息：

- Windows 版本
- 工具版本
- 模板 revision
- artifact 形式：
  - zip
  - legacy JSON package
- install 结果
- uninstall 结果
- rollback 结果
- verify 结果
- 是否实际被工具识别并生效
- 异常日志或截图路径

建议把每次验证结果沉淀到单独 markdown 记录，再决定是否升为 `verified`。

## 5. 升级为 verified 的门槛

1. 同模板在 2 个工具版本上验证通过：
   - 当前稳定版
   - 上一个稳定版
2. install / uninstall / rollback / verify 四操作成功率 100%。
3. managed_block 模板必须验证：
   - 块内改动默认不覆盖
   - 卸载只删除受管块
   - 回滚能恢复先前内容
4. 目标工具必须实际识别并生效。
5. 验证证据必须可追溯到模板 revision 与 artifact checksum。

## 6. 下一轮最该补的真机任务

1. 先完成 Cursor / OpenCode 在真实 zip artifact 下的 Windows 回归。
2. 再做 `Cline` project 与 `Codex` project 的 PoC。
3. 最后再评估是否推进任何 `global` 模板进入下一阶段。
