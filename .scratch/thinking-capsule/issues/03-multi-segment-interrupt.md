Status: ready-for-agent

# 多段穿插与中断态:独立胶囊 + 半截留显

## What to build

agent 多步推理(思考 -> 工具 -> 思考 -> 回答)时,多段胶囊按时序穿插在工具调用之间,各自独立 segment 不串。agent 中断(用户停止 / 出错)时,半截思考保持展开,用户看到 agent 想到哪儿。

中断态的支点是 `streaming` 标记:reducer 的 `done`/`error` 分支必须遍历当前 assistant 的 segments,把所有 `streaming===true` 的 thinking 段置 `streaming:false`(`collapsed` 不动 -> 半截展开)。没有这个标记,`done` 时不知道哪些 thinking 段是半截、该不该留展开。这是 prototype 验证后的关键决策,别图省事省掉遍历。

`thinking_delta` 配对规则:从末尾找最近一个 `streaming===true` 的 thinking segment 追加(不按 `kind===text` 配对),保证多段不串。

## Acceptance criteria

- [ ] reducer 多段 thinking 各自独立 segment:两次 `thinking_start` 之间夹 `tool_start` 时,`thinking_delta` 按 `streaming` 配对到正确段,text 不串
- [ ] reducer `done` 遍历当前 assistant segments,把所有 `streaming===true` 的 thinking 置 `streaming:false`,`collapsed` 保持(半截展开)
- [ ] reducer `error` 同上
- [ ] ChatPanel 渲染多胶囊按时序穿插(与 tool segment 交替);中断半截胶囊留显(展开态)
- [ ] Seam 2 测多段不串:两次 `thinking_start` 夹 `tool_start` -> 两个独立 thinking 段,`thinking_delta` 各归各位
- [ ] Seam 2 测中断:`done` 时仍有 `streaming` thinking -> `streaming:false`、`collapsed` 不变(半截展开)
- [ ] 多步推理端到端可 demo:思考 -> 工具 -> 思考 -> 回答,多胶囊穿插,各自可独立 toggle
- [ ] 中断端到端可 demo:思考中点停止,半截胶囊保持展开

## Blocked by

- 02 - 单段思维链胶囊:转发 + 渲染 + 收缩/toggle
