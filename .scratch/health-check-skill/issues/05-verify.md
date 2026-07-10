Status: ready-for-agent

# 05 - 验证 + 提交

## Parent

ADR-0009。

## What to build

全量验证 + 提交。

- make typecheck(server + web + scripts + desktop 全过)
- make format
- npm test(含新 healthCheck.test.ts)
- make health(CLI 行为不变)
- 手动:dev 形态点健康检查按钮 -> agent 调 health_check 工具 -> chat 展示解读 -> log.md 追加 lint 记录
- /review 复审
- commit 到 main(conventional commits)

## Acceptance criteria

- [ ] typecheck + format + test 全过
- [ ] make health 输出与重构前一致
- [ ] 手动端到端:按钮 -> 工具调用 -> 解读 -> log.md
- [ ] /review 通过
- [ ] commit 到 main
