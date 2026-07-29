# ADR-0025: ingest 日志 server 兜底补记(log.md 完整率 100%)

- 状态:accepted
- 日期:2026-07-29
- 范围:layer3(server `ingestLogFallback.ts` + 两条 ingest 路径接入)、layer1(Metadata `log.md` 的写入方扩列)
- 关联:ADR-0024(编译小结,补记条目的摘要来源);同 pattern ADR-0002/0016(prompt 引导 + 代码兜底双层防御)

## 背景

§5 要求 agent 每次 ingest/query 后追加 `log.md`(操作时间线,Metadata sub-seam)。但这只是 prompt 层约定,无代码强制:实测连续 4 次 ingest(upload + a2a 混合)在 `log.md` 里一条记录都没有,而文件 mtime 证明 wiki/output 确实被更新了。日志缺失是静默的——没有任何信号表明 agent 跳过了这一步,事后取证会被带偏(把不完整的 log 当完整时间线)。

## 决策

ingest 的 log 记录加代码兜底,贴合项目既有的「prompt 引导 + 代码兜底」双层防御(raw/ 只读即此模式):

### D1:检测 = log.md mtime 快照比对,不解析内容

ingest 开始时 `snapshotLogMtime(kbRoot)` 取 `log.md` mtime(不存在为 `null`),agent 回合结束后复取比对:**未变(漏记)→ server 补记;已变(守约)→ 不动作**。不解析条目内容判断"agent 写的是不是本次 ingest"——那是语义判断,脆弱且过度;mtime 只回答"log 被碰过没有",足够。

### D2:补记条目复用编译小结,非纯机械文案

补记条目按 §5 模板构造,摘要直接复用 ADR-0024 的编译小结(agent 收尾文本,含动作+涉及文件+理由)——agent 虽然忘了写日志,但它收尾时已经"口述"过本次动作,补记把它落盘。条目在「操作」栏标注 `ingest(server 补记)`,与 agent 亲写条目可区分,供事后审计。

### D3:仅 ingest 路径,query/lint 不兜底

query(chat)场景 agent 的收尾文本直接面向用户,没有"编译小结"概念,补记缺乏语义来源;lint(health-check)同理。这两类维持纯 prompt 约定,漏记风险接受(实测漏记发生在 ingest)。后续若观察到 query 也频繁漏记,再议同样机制。

### D4:layer1 写入方扩列,明确破例范围

`log.md` 是 layer1 Metadata,CONTEXT.md 原契约「agent 全权维护,server 只读(除上传归档)」。本决策把 server 的 layer1 写入范围扩为:**上传归档(raw/)+ ingest 日志兜底(log.md)**。server 不写 wiki/output/index.md(知识本体仍 agent 全权)。

## 固有边界

- 并发 ingest 互相撞 mtime:另一个 ingest 的写入会让本 ingest 跳过补记(判断"log 被碰过"为真)。并发 ingest 本就在 ADR-0024 固有边界内(无队列),不另做串行化。
- agent 守约但条目质量差(写错主题、漏涉及文件)不补救——mtime 只保证"写过",不保证"写好"。
- 补记发生在 agent 回合成功结束后;回合异常(ingest_error)不补记(不是一次完成的 ingest)。

## 后果

- 新增 `ingestLogFallback.ts`(`snapshotLogMtime` / `buildFallbackEntry` / `appendIngestLogIfUntouched`);`runIngest` 与 `/api/ingest` 接入,补记经 `withFileLock` 串行化(与 server 其他 kb/ 写一致)。
- `log.md` 完整率从"靠 agent 自觉"变为 100%(ingest 场景);条目双轨(agent 亲写丰富 / server 补记简版+标注)。
- CONTEXT.md 修订 layer1 契约表述(server 写入方扩列)。
- 测试:`ingestLogFallback.test.ts`(条目格式 3 例 + mtime 三分支 + 两路径集成 3 例)。
