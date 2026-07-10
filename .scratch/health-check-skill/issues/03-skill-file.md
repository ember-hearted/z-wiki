Status: ready-for-agent

# 03 - .pi/skills/health-check/SKILL.md

## Parent

ADR-0009。skill 指导 agent 调工具+解读+写 log.md。

## What to build

创建 `<appRoot>/.pi/skills/health-check/SKILL.md`(dev 形态 appRoot=项目根,即 `.pi/skills/health-check/SKILL.md`)。

- frontmatter:`name: health-check`、`disable-model-invocation: true`(只经 /skill:health-check 触发完整流程;工具自主调时只检查不归档,见 Q4 ii)。
- 正文:调 `health_check` 工具获取 HealthReport -> 解读结构化结果(断链数/孤儿/空文件/重复/frontmatter 覆盖率) -> 按优先级(断链 > 空文件 > 孤儿)给修复建议 -> 追加 `log.md` lint 记录(格式 `## [YYYY-MM-DD] lint | 知识库健康检查`,含关键指标摘要)。
- 不让 agent 用 bash 跑脚本(白名单不允许,ADR-0007);扫描结果全从 health_check 工具拿。

## Acceptance criteria

- [ ] `.pi/skills/health-check/SKILL.md` 存在,frontmatter name + disable-model-invocation: true
- [ ] 正文含:调 health_check 工具 -> 解读 -> 写 log.md 流程
- [ ] 不含跑脚本指令
- [ ] dev 形态 server 启动后 resourceLoader 加载该 skill(/skill:health-check 触发不透传)
