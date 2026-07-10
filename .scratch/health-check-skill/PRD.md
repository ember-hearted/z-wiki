# 健康检查 skill(快捷按钮 -> pi skill -> customTool)

## Parent

ADR-0009(`docs/adr/0009-quick-action-skill-customtool.md`)-- 快捷按钮经 `/skill:name` 触发 pi skill、skill 指导 agent 调 customTool 的集成模式。

## 背景

经 grilling 定:chat 对话框外加快捷按钮,首个为健康检查。健康检查 = `runHealthCheck` customTool(只读扫 kb/)+ `.pi/skills/health-check/` skill(指导 agent 调工具+解读+写 log.md)+ 前端按钮触发 `/skill:health-check`。不破 bash 白名单(ADR-0007)/ cwd / 只读契约。历史会话/resume 暂缓(见 memory `resume-session-deferred`)。

## Scope

5 个 issue:healthCheck 重构(库+CLI 搬 server/src,TDD)、health_check customTool、SKILL.md、前端按钮栏、验证。

## Out of scope

@ 文件提及、斜杠命令补全、历史会话/resume、/compact /fork。
