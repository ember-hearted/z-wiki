# ADR-0026: 收件提示词 + 胶囊开关 — 收件交互形态重做

- 状态:accepted
- 日期:2026-07-30
- 范围:layer2(web quickbar 收件胶囊 ReceiveAction + 收件提示词,删 A2AModal)
- 关联:ADR-0023(A2A 收件)、ADR-0009(quickbar 快捷按钮模式)、ADR-0003 D2(端口随机)
- supersede:ADR-0023 D3(说明文档始终显示,开关不触发布局变化)

## 背景

ADR-0023 的 Modal 说明文档落地后暴露两个问题:

1. **形态错配**:说明文档的实际用途是「复制 → 粘贴给外部 agent」的提示词,但文本写成了给人读的 API 参考(接口地址/请求格式/参数说明)。用户把要投递的内容拼在后面时不连贯,接收 agent 读不出「要我干什么」。
2. **交互冗余**:看说明要开 Modal,而 Modal 里唯一动作就是复制;开关与复制拆在两处。

另:功能名「A2A 收件」的 A2A 前缀暗示协议互联(Google A2A 协议),与「人复制粘贴当中转」的实际形态不符。术语弃用 A2A,定名**收件/发信**(CONTEXT.md 已收编);代码标识符 a2a*(`preferences.a2aEnabled`、WS `a2a_changed`)保留不迁移。

## 决策

### D1: 说明文档改为收件提示词

文本形态从 API 文档改为给 agent 的指令:任务开头(请帮我投递)→ 投递方法(jq 构造 JSON + curl,防手写转义坑)→ 规则(原样发送/title 与 source 约定/成功转告编译小结/403 与连接失败的提醒话术/无终端能力直说)→ 末尾「要投递的内容」粘贴位。复制时 `{port}` 替换为 `window.location.port`(沿用 ADR-0023 D2 机制,端口保持随机)。

**发信职责定为只搬运**:清理/总结/归类是 z-wiki Ingest 编译的本职(有 kb 上下文),`raw/` 契约是原始来源原样归档,接收 agent 不预整理。

### D2: Modal 删除,quickbar 收件位改胶囊

胶囊 = 左开关 + 小竖线分隔 + 右复制按钮。关态复制禁用(延续 ADR-0023 D1 双层控制精神:关 = 完全不动作);开态点复制直接写剪切板,图标变 ✓ 1.5s(复用 chatCopy 反馈模式)。开态呼吸边框沿用 `.chat-quick-on`。

**为什么接受「关态无入口读说明」**(supersede ADR-0023 D3):桌面形态是单用户 app,新用户发现场景几乎不存在;说明以提示词形态随复制分发,接收 agent 读到的即是完整使用说明,D3 保护的「看怎么用」诉求改由提示词自身承担。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `web/src/components/ReceiveAction.tsx` | 新文件:胶囊组件 + 收件提示词常量 + `buildReceivePrompt` 纯函数 |
| `web/src/components/A2AModal.tsx` | 删除 |
| `web/src/components/ChatPanel.tsx` | quickbar 收件位换胶囊,删 Modal state/渲染 |
| `web/src/styles/chat.css` | 删 Modal/遮罩/面板样式,加 `receive-*` 胶囊样式 |
| `CONTEXT.md` | 收编 收件/发信/收件提示词 词条 |
