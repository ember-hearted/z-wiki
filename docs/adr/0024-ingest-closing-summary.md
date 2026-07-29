# ADR-0024: ingest 编译小结 — 通知展示 agent 收尾文本

- 状态:accepted
- 日期:2026-07-29
- 范围:layer3(server `buildIngestPrompt` 第 7 步契约 + `ingestSummary.ts` 收集 + `ingest_done` 广播带 `summary`)、layer2(web `useChat` 摘要消息 + 系统消息 wikilink 渲染)
- 关联:extends ADR-0019(ingest 事件引出,同一 onEvent 通道)、ADR-0023(a2a 收件,response 语义在此明确化)

## 背景

上传与 a2a 收件完成后,前端只显示写死的静态模板(「已处理上传文件 X,知识库已更新」/「来自 Y 的内容已编译」)。但知识库是增量维护的:同一主题多份源陆续上传,agent 实际做的是"新建 wiki + 产出 output"或"合并进既有 wiki,不新建 output"(§1 编译规则 + §7 不重复产出约束)——每次动作不同,静态模板永远说不准,在"合并"场景下近乎说谎(说"已更新",可见的书可能没动)。

机制上,a2a 路径(`POST /api/ingest`)早已收集 agent 的 `text_delta` 拼成 `response` 返回调用方;上传路径(`runIngest`)却把 agent 文本整个丢弃,只广播 `ingest_done{raw}`。两条路径不对称,前端拿不到"到底干了什么"。

## 决策

### D1:信息来源 = agent 收尾文本(编译小结),不做机械 diff

`ingest_done` 广播新增 `summary` 字段,内容是 ingest agent 的收尾文本。候选方案里:

- **server 机械 diff**(ingest 前后快照 `wiki/`/`output/` 文件列表推导"新增 X/更新 Y"):确定性好,但说不出"合并了事件规范,因同主题报告已存在故不新建 output"这类语义与理由,且 agent 的 merge 行为本就逐 run 漂移,机械推导永远落后于它的实际动作。
- **解析 log.md 最后一条**:agent 会漏记 §5 日志(实测发生过),不可靠。
- **agent 收尾文本**:agent 是唯一知道"为什么"的一方;a2a 路径已有收集机制,upload 路径补对称收集即可。

`/api/ingest` 的 HTTP `response` 与广播 `summary` 统一为同一文本,两条路径零分歧。

### D2:收集 = 只取最后一条 assistant 消息

新增 `ingestSummary.ts` 的 `collectClosingText()`:喂 pi 事件流,`message_start`(role=assistant)重置缓冲、`message_update.text_delta` 拼接——只保留**最后一条 assistant 消息**的文本,中间轮的过渡文本(如"我先读取文件")丢弃。

`/api/ingest` 的 `response` 语义随之从"全程 text 拼接"明确为"收尾消息"(ADR-0023 未钉死此语义,此处补钉):对 a2a 调用方更干净,且与广播一致。agent 未产出文本(全程只调工具)时 `summary` 为 `''`,前端回退静态模板。

### D3:格式契约 = prompt 层自由文本,不做结构化

`buildIngestPrompt` 加第 7 步硬契约:收尾必须输出编译小结(一两句话,≤80 字),要素 = 本次动作(新建/合并/更新/未编译)+ 涉及文件 + 一句话理由;wiki/output 文章用 `[[NN-主题]]` 引用(不带路径与 `.md`),raw 文件用纯文本路径。

候选的结构化(JSON 动作类型+文件列表)被否:LLM 格式输出脆(要多轮约束兜底),与 a2a `response` 的自由文本分叉,且前端要的可点链接靠 wikilink 就能拿到,不需要结构。

### D4:前端系统消息升级渲染 wikilink

`useChat` 抽 `ingestDoneMessage()` 纯函数:有 `summary` 用小结并标 `markdown: true`,无则回退原静态模板。`ChatPanel` 系统消息分支对 `markdown` 消息走 `mdToHtml` 渲染(与 assistant 文本块同源,XSS 安全已 escapeHtml)——`[[wikilink]]` 渲染为 `a.wl`,`useWikiLinkNav` 的 document 级委托让链接天然可点跳转,零新增导航逻辑。错误/纯通知类系统消息保持纯文本(不置 `markdown`,行为不变)。

## 固有边界

- 小结质量依赖 LLM:可能啰嗦、漏要素或偏离格式契约(无强制校验,只有 prompt 约束 + 前端 trim/回退)。这是 D1 选择的固有风险,换来语义与理由。
- agent 行为漂移(merge 目标选择逐 run 不同)不在本 ADR 解决——小结如实转述漂移的行为,不钉死行为本身。
- 快速连传多文件时多个 ingest session 并发无队列(既有事实),多条小结各说各话可能互相矛盾;串行化是独立的活,不在此范围。

## 后果

- `ingestPrompt.ts` 第 7 步;`ingestSummary.ts` 新增;`interaction.ts` 两条 ingest 路径广播带 `summary`,`/api/ingest` 的 `response` 复用同一收集器。
- `useChat.ts` 的 `ServerMsg.summary` / `ChatMessage.markdown` / `ingestDoneMessage()`;`ChatPanel.tsx` 系统消息 markdown 分支;`chat.css` 系统行 `<p>` 边距归零。
- CONTEXT.md「关键工作流」的 Ingest 条目补「编译小结」术语。
- 测试:`ingestSummary.test.ts`(收集器)、`ingestPrompt.test.ts`(7 步契约)、`ingestDoneSummary.test.ts`(两路径广播 + response 端到端)、`useChat.test.ts`(回退三分支)。
