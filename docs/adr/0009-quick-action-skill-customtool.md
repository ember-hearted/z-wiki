# 快捷按钮 -> pi skill -> customTool 集成模式(健康检查为首例)

- 状态:accepted
- 日期:2026-07-09
- 范围:layer2(chat 快捷按钮)+ layer3(agentHost customTool)+ pi skill 资源

## 背景

z-wiki 要在 chat 对话框外加快捷按钮(健康检查、历史提问)。健康检查的参考 ob-health-check 是 Claude Code skill(SKILL.md),其正文让 agent 用 bash 跑 Python 脚本。z-wiki 的 agent bash 受 pandoc 白名单限制(ADR-0007 决策 2)、cwd=kb/ 看不到项目根 `scripts/`,照搬该模式会破契约 + 安全降级。

## 决策

**快捷按钮 = 前端 `send('/skill:<name>')` 触发 pi skill;skill 正文指导 agent 调用配套 customTool + 解读 + 维护 Metadata。** pi 的 skill 能力默认已开(`DefaultResourceLoader` 的 `noSkills` 默认 false,projectTrusted 默认 true),skill 放 `<appRoot>/.pi/skills/<name>/SKILL.md` 即自动加载。`.pi/skills/` 不在 `.gitignore`(只忽略 `.pi/agent/` 运行时产物),可提交。

健康检查为首例:`scripts/healthCheck.ts` 重构出 `runHealthCheck(kbRoot): HealthReport` 纯函数(只读扫 kb/),注册为 `health_check` customTool(`defineTool`,与 `makeBashTool` 同位);skill 正文 = "调 `health_check` 工具 -> 解读断链/孤儿/空文件/重复/frontmatter -> 按优先级建议 -> 追加 `log.md` lint 记录"。快捷按钮 -> `send('/skill:health-check')` -> pi `_expandSkillCommand` 注入 skill 正文。

## 为什么不是其他路径

- **server 端点跑 + 前端直出**:agent 不在 loop 内,skill 多余,chat 里看不到检查过程与结论。
- **agent 用 bash 跑 healthCheck.ts**(照搬 ob-health-check):破 bash 白名单(ADR-0007)+ 破 cwd 契约 + 安全降级(agent 能跑任意 tsx)。
- **agent 用 read/grep/find 自扫**:重造 healthCheck.ts 250 行精确逻辑(wikilink 解析、占位符过滤、raw/ 引用),质量靠 LLM 必然退化。

## 工具触发权

`health_check` 注册进 agent 工具集后,pi 工具模型 session 创建时定 tools、不支持"仅某上下文可用"条件化。决策:接受 agent 自主调用(只读扫描不破契约,自然语言"检查知识库"也触发是 feature,非 bug);`log.md` 写入由 skill 正文控制而非工具,agent 不经 skill 自调工具时不会写 log,副作用隔离。配软约束 description 防无关对话乱调。

## 后果

- customTool 是 agent 能力的新扩展点;后续快捷按钮按需复用同模式,或走前端独立路径(如历史提问,见其分支决策)。
- `healthCheck.ts` 保留 CLI entry(`make health` 写 `kb/health-check/` 归档),与 `runHealthCheck` 纯函数共享核心,两条路并存。
- 桌面形态 appRoot=UserDataDir,skill 进 UserDataDir 是打包问题(切片 06,app bundle 带一份启动复制,与 `models.json` 派生同类),dev 形态先跑通。
