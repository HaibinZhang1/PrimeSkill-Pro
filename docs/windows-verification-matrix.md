# Windows 真机验证矩阵（candidate -> verified）

## 模板验证范围

| Tool | Template | State | 必测项 |
|---|---|---|---|
| Cursor | `${workspaceRoot}/.cursor/rules/${skillKey}.mdc` | verified | install/upgrade/uninstall/rollback + 生效验证 |
| Cursor | `${workspaceRoot}/AGENTS.md` managed_block | candidate | 受管块冲突、块内修改保护、卸载仅删块 |
| Cline | `${workspaceRoot}/.cline/skills/${skillKey}/SKILL.md` | candidate | 目录写入、升级替换、回滚快照恢复 |
| Cline | `${workspaceRoot}/.clinerules` managed_block | candidate | 受管块冲突、卸载仅删块 |
| Cline | `${userHome}/.cline/skills/${skillKey}/SKILL.md` | candidate | 全局路径可写、权限策略一致 |
| OpenCode | `${workspaceRoot}/.opencode/skills/${skillKey}/SKILL.md` | verified | install/upgrade/uninstall/rollback + 生效验证 |
| OpenCode | `${userHome}/.config/opencode/skills/${skillKey}/SKILL.md` | candidate | Windows 可写性与工具识别 |
| OpenCode | `${workspaceRoot}/.agents/skills/${skillKey}/SKILL.md` | candidate | 兼容路径行为与回滚 |
| Codex | `${workspaceRoot}/AGENTS.md` managed_block | candidate | 受管块升级/卸载/回滚 |

## 升级为 verified 的门槛

1. 同模板在 2 个工具版本（当前稳定 + 前一版本）全部通过。
2. install/upgrade/uninstall/rollback 四操作成功率 100%。
3. 受管块冲突策略验证通过（块内改动默认不覆盖）。
4. 撤销设备信任后，native manifest 拉取必须拒绝。
5. 回滚后目标工具可正常识别并生效。
