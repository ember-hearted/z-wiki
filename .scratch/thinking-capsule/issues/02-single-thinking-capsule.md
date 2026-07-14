Status: ready-for-agent

# 单段思维链胶囊:转发 + 渲染 + 收缩/toggle

## What to build

用户在对话中首次看到 agent 的思考。DeepSeek 等 reasoning 模型思考时,单段胶囊流式展开显示思维链文本;该段思考结束(`thinking_end`)自动收缩为"思考 · N 字";点击胶囊可展开回看(展开态 max-height + 内部滚动,纯文本 `pre-wrap`)。端到端打通 server 事件转发 -> layer2 reducer -> ChatPanel 渲染,单段场景(无工具穿插)可 demo。

Segment type 扩展(prototype 定型):`{ kind: 'thinking', id, text, collapsed, streaming }`。

关键决策:`collapsed` 真相源在 reducer(segment 字段),**不**在组件 local state--否则 `thinking_end` 设的 `collapsed:true` 会与 local state 打架。用户点击 toggle dispatch 一个 action 改 `segment.collapsed`。

WS 帧契约(来自 pi-ai `AssistantMessageEvent`):

- `thinking_start` -> `{ type: 'thinking_start' }`
- `thinking_delta` -> `{ type: 'thinking_delta', text: <delta> }`
- `thinking_end` -> `{ type: 'thinking_end' }`

## Acceptance criteria

- [ ] server `relayEvent` 转发 `thinking_start`/`thinking_delta`/`thinking_end` 三个 WS 帧(`message_update` 的 `assistantMessageEvent` 按 type 分流,`text_delta` 不受影响)
- [ ] reducer `applyServerMsg` 处理三事件:`thinking_start` 建 thinking segment(`streaming:true, collapsed:false, text:''`)、`thinking_delta` 追加到最近 `streaming` thinking 段、`thinking_end` 置 `collapsed:true, streaming:false`;toggle action 翻转指定段 `collapsed`
- [ ] ChatPanel 渲染 thinking segment:展开态(纯文本 `pre-wrap` + max-height + `overflow-y:auto`)、收缩态(`思考 · {text.length} 字` + 展开箭头,整行可点 toggle)、视觉与 text/tool segment 区分
- [ ] Seam 1(`relayEvent` 纯函数)测 thinking 三事件转发 + `text_delta` 回归不受影响
- [ ] Seam 2(`applyServerMsg` reducer)测建段/续写/`thinking_end` 收缩/toggle
- [ ] 单段思考端到端可 demo:DeepSeek 思考时胶囊流式展开 -> 结束收缩 -> 点击展开回看
- [ ] `thinkingLevel=off` 或模型不支持 reasoning 时无 thinking 事件 -> 无胶囊、不占位(自然成立,不特判)

## Blocked by

- 01 - prefactor:提取 relayEvent 与消息 reducer 为纯函数,引入 web 测试
