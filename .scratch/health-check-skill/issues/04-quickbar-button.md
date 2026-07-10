Status: ready-for-agent

# 04 - 前端快捷按钮栏 + 健康检查按钮

## Parent

ADR-0009 + Q1 布局决策。

## What to build

`web/src/components/ChatPanel.tsx` 在 composer(`chat-input-row`)上方插 `chat-quickbar`,首个按钮为健康检查。

- `chat-quickbar`:`display:flex; gap:8px;`,左对齐,溢出 `overflow-x:auto`(Q1:≤4 横排,>4 横滑,分组推迟)。
- 左边缘与 textarea 左边缘对齐(同 padding);不追 upload 按钮左边缘(浮动,Q1)。
- 健康检查按钮:点击 `send('/skill:health-check')`。disabled 条件同 send(`!connected || streaming`)。
- 样式在 web/src/styles 加(对齐现有 chat 样式风格)。

## Acceptance criteria

- [ ] ChatPanel composer 上方有 chat-quickbar,含健康检查按钮
- [ ] 按钮点击发 /skill:health-check(经现有 send/WS)
- [ ] streaming/断线时按钮 disabled
- [ ] 布局左对齐、不超 textarea 左边缘
- [ ] make typecheck + make format 通过
