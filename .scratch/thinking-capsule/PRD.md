Status: ready-for-agent

# 思维链胶囊(reasoning capsule)

## Problem Statement

对话事件流中,reasoning 模型(DeepSeek 等)在思考时产出的思维链内容被 server 丢弃,layer2 从未接收或渲染。用户只能看到 agent 的最终回复与工具调用,看不到"它为什么决定调这个工具""如何推导出这个结论",无法理解决策过程。即便快捷操作能切换思考级别,思考内容本身始终不可见。

## Solution

在事件流中转发并渲染思维链。每段思考作为 assistant 消息的一个 segment(与 text/tool segment 并列),按时序穿插在工具调用之间。流式期间胶囊展开显示思考文本;该段思考结束(`thinking_end`)时胶囊自动收缩为"思考 · N 字"摘要;用户可单独点击展开回看,展开态有最大高度与内部滚动。agent 中断时半截思考保持展开。思考关(off)或模型不支持 reasoning 时不产出事件、不显示胶囊、不占位。

## User Stories

1. 作为对话用户,我想在事件流中看到 agent 的思维链,这样我能理解决策与推导过程。
2. 作为对话用户,我想思维链按时序穿插在工具调用之间,这样我能看到"思考 -> 工具 -> 再思考"的衔接,而非一大坨开头思考。
3. 作为对话用户,我想流式期间胶囊展开显示思考文本,这样我能实时跟随 agent 思考。
4. 作为对话用户,我想该段思考结束后胶囊自动收缩,这样不挡后续工具调用与正文。
5. 作为对话用户,我想收缩胶囊显示"思考 · N 字",这样我知道这段思考的规模。
6. 作为对话用户,我想点击收缩胶囊展开回看,这样我能细读思考过程。
7. 作为对话用户,我想展开的胶囊有最大高度与内部滚动,这样长思维链不撑爆消息流。
8. 作为对话用户,我想每个胶囊独立展开/收缩,这样我能按需查看某一段。
9. 作为对话用户,我想手动展开的胶囊不被后续新思考归位,这样我的查看状态保持。
10. 作为对话用户,我想 agent 中断时半截思考保持展开,这样我能看到 agent 想到哪儿了。
11. 作为对话用户,我想思考关(off)或模型不支持 reasoning 时不显示胶囊,这样不占位、不干扰。
12. 作为对话用户,我想多段思考各自独立胶囊,这样时序清晰。
13. 作为对话用户,我想思维链按纯文本渲染,这样半截代码块或不规范内容不渲染异常。
14. 作为对话用户,我想 DeepSeek 等模型的 reasoning_content 能被正确捕获展示,这样思考级别(high/xhigh)产出的内容可见。
15. 作为对话用户,我想胶囊视觉与工具调用气泡区分,这样我一眼分清"思考"与"行动"。

## Implementation Decisions

### 架构契约对齐

延续 ADR-0004 D8(thinking mode):思考级别(off/minimal/low/medium/high/xhigh)与"是否支持思考"已落地。本 spec 补上被遗漏的第三环--思考内容的事件转发与渲染。三层边界不动:server(Interaction)转发事件,layer2(useChat + ChatPanel)接收渲染,不互写文件系统。

### 事件转发契约(server Interaction `relayEvent`)

当前 `relayEvent` 在 `message_update` 只转发 `text_delta`,丢弃 `thinking_*`。扩展为同时转发 thinking 三事件(WS 帧契约,来自 pi-ai `AssistantMessageEvent`):

- `thinking_start` -> `{ type: 'thinking_start' }`
- `thinking_delta` -> `{ type: 'thinking_delta', text: <delta> }`
- `thinking_end` -> `{ type: 'thinking_end' }`

pi-ai 的 thinking 事件来源:openai-completions 从 `reasoning_content` / `reasoning` / `reasoning_text` 字段提取(覆盖 DeepSeek 官方端点与 ark 等代理端点);openai-responses 从 reasoning summary、anthropic 从 thinking block 也统一成 `thinking_*`。z-wiki 只转 pi 已产出的统一事件,不按 api spec 分别解析原始字段。

### Segment 类型扩展(layer2 useChat)

assistant 消息的 `segments` 当前是 text/tool 两种 kind 的 union。扩展第三种(prototype 定型的 type shape):

```
{ kind: 'thinking', id, text, collapsed, streaming }
```

- `text`:累积的思考文本(`thinking_delta` 续写)
- `collapsed`:是否收缩(`thinking_end` 设 true;用户 toggle 改)
- `streaming`:是否正在流式(`thinking_start` 建 true,`thinking_end` / `done` / `error` 置 false)

`collapsed` 的真相源在 reducer(segment 字段),**不**放在组件 local state--否则 `thinking_end` 设的 `collapsed:true` 会与 local state 打架。用户点击展开/收缩 dispatch 一个 toggle action 改 `segment.collapsed`。

### reducer 行为(`applyServerMsg`)

- `thinking_start`:往当前 assistant 的 segments 追加 `{ kind:'thinking', id, text:'', collapsed:false, streaming:true }`。
- `thinking_delta`:从末尾找最近一个 `streaming===true` 的 thinking segment,追加 `text`(参照 text_delta 的末段续写模式,但按 `streaming` 配对,不按 `kind`)。
- `thinking_end`:把那个段置 `collapsed:true, streaming:false`。
- `done` / `error`:遍历当前 assistant segments,把所有 `streaming===true` 的 thinking 段置 `streaming:false`(`collapsed` 不动 -> 中断半截保持展开)。
- 用户 toggle:dispatch 改指定 thinking segment 的 `collapsed`。

### 渲染(layer2 ChatPanel)

segments 渲染器加 `kind === 'thinking'` 分支,胶囊组件:

- 收缩态:一行 `思考 · {text.length} 字` + 展开箭头,整行可点(toggle collapsed)。不编号,多段都这格式。
- 展开态:`white-space: pre-wrap` + `max-height`(可调,约 12rem)+ `overflow-y: auto`。纯文本,不走 markdown 渲染器。
- 视觉与 tool segment 区分(不同底色/border),与 text segment(正文)区分。

### 持久化

瞬态,不进序列化结构。z-wiki 当前不恢复 pi session 历史(resume 暂缓),刷新即开新会话,对话与思维链一起丢。胶囊只在流式期存活。持久化等 resume 一起做(届时再定 thinking 是否进 ChatMessage 序列化)。

### 边界

- `thinkingLevel=off` 或模型不支持 reasoning:pi 不产出 thinking 事件 -> 无 thinking segment -> 无胶囊、不占位。自然成立,无需特判。
- 多段思考:agent 一轮可能 思考->工具->思考->工具->回答,每段 `thinking_start` 各建一个胶囊,按时序穿插。
- 中断:`done`/`error` 把 streaming thinking 置 `streaming:false`,`collapsed` 保持 false(半截展开)。

## Testing Decisions

### 好测试的标准

只测外部行为,不测实现细节:

- server:测"pi 产 thinking 事件 -> WS 帧正确",不测 `relayEvent` 内部分支结构。
- 前端:测"收到 WS 帧 -> segments 状态正确",不测 reducer 内部辅助函数。

### Seam 1 - server `relayEvent` 纯函数

从 Interaction 闭包提取 `relayEvent(socket, event)` 为模块级导出函数,注入 mock socket(`{ send: (s) => calls.push(s) }`),断言:

- `thinking_start` 事件 -> WS 帧 `{type:'thinking_start'}`
- `thinking_delta` 事件(带 delta)-> WS 帧 `{type:'thinking_delta', text:<delta>}`
- `thinking_end` 事件 -> WS 帧 `{type:'thinking_end'}`
- 回归:`text_delta` 仍正常转发(不被改动破坏)
- 其他事件(`tool_execution_*`、`agent_end`)不受影响

Prior art:server `*.test.ts`(`node:test` + `assert`)。`relayEvent` 提取为纯函数是必要重构(闭包内无法测),提取后行为不变。

### Seam 2 - 前端 `useChat` 消息 reducer 纯函数

从 `onmessage` 提取 reducer 为纯函数 `applyServerMsg(state, msg) -> state`,断言:

- `thinking_start` -> 当前 assistant segments 末尾新增 thinking 段(`streaming:true`, `collapsed:false`, `text:''`)
- `thinking_delta` -> 最近 `streaming` thinking 段 text 追加
- `thinking_end` -> 该段 `collapsed:true`, `streaming:false`
- `done` 时仍有 `streaming` thinking -> `streaming:false`,`collapsed` 保持 false(中断半截展开)
- `error` 同上
- 多段:两次 `thinking_start` 之间夹 `tool_start` -> 两个独立 thinking 段,不串
- toggle action -> 指定段 `collapsed` 翻转,不影响其他段

需给 layer2(web)新增测试运行器:对齐 server 的 `tsx --test`(`node:test` + `assert`),纳入 `npm test`。web 目前零测试,这是首次引入。

### 不测

胶囊渲染(展开/收缩视觉、max-height 滚动、中断半截显示):纯展示,靠手动验证。理由:web 无组件测试基础设施,引入成本与收益不匹配;渲染行为简单(条件渲染 + CSS),手动可覆盖。

## Out of Scope

- resume / 持久化:思维链不进序列化,刷新即丢。等 resume 一起做(届时定 thinking 字段是否进 ChatMessage 序列化、历史胶囊默认展开还是收缩)。
- markdown 渲染:thinking 内容按纯文本 `pre-wrap`,不走 markdown 渲染器(半截代码块/列表不怕显示原始符号)。
- 多段编号/区分:收缩态统一"思考 · N 字",不加编号、不关联工具名。
- E2E 测试:server 与前端两进程,无 E2E 基础设施。
- 非 reasoning 模型占位:off/不支持时不占位,不做"未开启思考"提示(快捷操作按钮的灰显 tooltip 已承担此职责)。
- thinking 内容的复制/导出:展开态 `pre-wrap` 默认可选,不额外加复制按钮。

## Further Notes

- ADR-0004 D8 的第三环:级别切换 + 是否支持已落地,本 spec 补内容展示。三环闭环后,用户可:开思考(设置页 reasoning + 快捷切级别)-> 看思考(胶囊)-> 调级别看不同深度思考。
- DeepSeek thinkingLevelMap(minimal/low/medium/high -> high,xhigh -> max)已在 generateModelsJson 注入,与本 spec 无交互(级别映射在 pi-ai 层,z-wiki 只看 thinking 事件)。
- 中断态(13a)的支点是 `streaming` 标记:没有它,`done` 时不知道哪些 thinking 段是半截、该不该留展开。reducer 的 `done`/`error` 分支必须遍历清 `streaming`。
- `collapsed` 真相源在 reducer 而非组件 local state,是 `thinking_end` 自动收缩与用户手动 toggle 不打架的关键--这条是 prototype 验证后的决策,别在实现时图省事改成 local state。
- 测试 seam 数为 2(server 转发 + 前端 reducer),做不到 1:server 与 layer2 是两个进程,无 E2E 基础设施。渲染不测(纯展示)。
