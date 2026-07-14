Status: ready-for-agent

# prefactor:提取 relayEvent 与消息 reducer 为纯函数,引入 web 测试

## What to build

不交付用户行为,为后续思维链胶囊铺路。把 server Interaction 的 `relayEvent` 从闭包提取为模块级纯函数(注入 socket 可测),把 layer2 useChat 的 `onmessage` reducer 提取为纯函数 `applyServerMsg`,web 首次引入 `tsx --test`(`node:test` + `assert`)纳入 `npm test`。为现有 `text_delta`/`tool_*`/`done` 行为加回归测试,确保提取后行为零变化。这是"make the change easy",让后续 thinking 事件处理能在纯函数 seam 上测试。

延续 ADR-0004 D8(thinking mode)已落地的级别切换与"是否支持思考",本 ticket 不触碰 thinking 逻辑,只重构现有转发与状态机为可测形态。

## Acceptance criteria

- [ ] `relayEvent` 提取为模块级导出纯函数(接收 socket + event),现有 `text_delta`/`tool_execution_start`/`tool_execution_end`/`agent_end` 转发有回归测试(注入 mock socket 断言 WS 帧)
- [ ] `applyServerMsg` reducer 提取为纯函数(接收 state + msg -> state),现有 `text_delta`/`tool_start`/`tool_end`/`done` 行为有回归测试
- [ ] web 引入 `tsx --test`,对齐 server 的 `node:test` + `assert`,纳入 `npm test`
- [ ] 现有行为零回归(server + web 既有测试 + 新增回归测试全过,`make typecheck` + `make lint` 无新增错误)

## Blocked by

无 - 可立即开始
