Status: ready-for-agent

# 02 - health_check customTool 注册

## Parent

ADR-0009。本 issue 是 (d) 路径的"agent 调用工具"落点。

## What to build

在 `server/src/agentHost.ts` 新增 `health_check` customTool,调 `runHealthCheck(currentKbRoot)` 返回 `HealthReport` JSON。

- 用 `defineTool`(pi-coding-agent)注册,与 `makeBashTool` 同 `customTools` 数组位。
- 工具入参:无(扫整个当前 kb/)。执行:`const report = await runHealthCheck(kbRoot)` 返回 report(pi 序列化为 JSON 进 agent 上下文)。
- description(软约束,Q4 ii):"扫描知识库健康(断链/孤儿/空文件/重复/frontmatter 覆盖率),返回结构化结果。仅用于健康检查;归档到 log.md 走 /skill:health-check。"
- 不经 bashWhitelist(非 bash 工具);用 kbRoot 参数不依赖 agent cwd。

## Acceptance criteria

- [ ] agentHost.ts `customTools` 含 health_check 工具
- [ ] 工具调 runHealthCheck(currentKbRoot) 返回 HealthReport
- [ ] description 含软约束(仅健康检查、归档走 skill)
- [ ] make typecheck 通过(类型对齐 pi ToolDefinition)
