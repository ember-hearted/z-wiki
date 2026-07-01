# ADR-0002: layer1 契约下沉 —— raw/ 只读走代码、sub-seam 命名集中、kb/ 收拢

- 状态:accepted
- 日期:2026-07-01
- 范围:layer1(知识层)的目录契约、命名与物理位置,及 server 对这些契约的引用方式
- 关联:ADR-0001(server seam)、CONTEXT.md(领域词汇)

## 背景

ADR-0001 把 server 拆成 AgentHost + Interaction,可视数据走 HTTP。但 layer1 仍有两个问题:

1. **契约只在 prompt 字符串里** —— raw/ 只读是一行字,agent 违反无代码阻挡;目录语义散在 prompt.ts/buildView.ts/kbHooks.ts 三处硬编码。
2. **layer1 内容散落项目根** —— `raw/ wiki/ output/ index.md log.md` 直接摊在根目录,与 server/web/docs 平级。三层已逻辑分离,但物理上 layer1 没有边界,根目录杂乱,agent 的 cwd 是整个项目(能看到 server/web/.pi)。

1. **raw/ 只读** 只是 prompt 里一行字(L21/L203)。agent 若用 `write`/`edit` 碰 `raw/`,没有任何代码层阻挡 —— 违反即污染源头数据,且 server 无从感知。
2. **目录语义散落** —— `prompt.ts` 文字、`buildView.ts` 硬编码 `"wiki"/"output"/"health-check"`、`kbHooks.ts` 硬编码 `"wiki/","raw/","output/"`。同一概念三处定义,改一处忘另两处即漂移。
3. **遗留概念自相矛盾** —— prompt 里 `raw/imported/`(非 md 转换产物,隐含 agent 可写)与 `raw/ 只读` 冲突;`view/` 目录(旧 Python 版静态站)已不再使用却仍在 prompt 里;`pending/` 草稿区从未被代码引用却占着 sub-seam 位置。

layer1 的契约是 gentlemen's agreement:只要 LLM 不守规矩或 prompt 漂移,源头数据就被污染。这是 ADR-0001 评审时标记的 Top recommendation 根因。同时 layer1 内容散落根目录,三层物理边界模糊。

## 决策

### 决策 0:layer1 内容收拢到 `kb/`,agent cwd = `kb/`

把 `raw/ wiki/ output/ index.md log.md` 全部移到 `kb/` 下。根目录只剩 server/web/docs/scripts 等代码目录,layer1 有了物理边界。

`createAgentSession` 的 `cwd` 从 `PROJECT_ROOT` 改成 `KB_ROOT`(=`<projectRoot>/kb`)。agent 的世界就是知识库:bash `ls` 列出的是 raw/wiki/output,agent 物理上看不到 server/web/.pi。prompt 里现有的相对路径写法(`raw/` `wiki/` `index.md` `[[raw/...]]`)因 cwd 换成 kb/ 而**全部仍然正确**,无需逐条改前缀 —— 这是 cwd=kb/ 的最大红利。

`kb/` 整个目录 gitignore(知识库内容由 agent 维护,不入 git)。为让拿到项目的人有骨架,建 `kb_example/`(纯结构样板:`raw/` `wiki/` `output/` 各放 `.gitkeep` + `index.md`/`log.md` 最小骨架 + README 说明各 sub-seam 契约),入 git。server 启动时检测 `kb/` 不存在则报错退出,提示 `cp -r kb_example kb` —— 不自动创建,避免隐式副作用。

### 决策 1:layer1 契约集中到 `kbLayout.ts`

新建 `server/src/kbLayout.ts`,导出:

- `KB_ROOT`(项目根下的 `kb/`)与四条 sub-seam 路径常量(`RAW_DIR` / `WIKI_DIR` / `OUTPUT_DIR` / `INDEX_FILE` / `LOG_FILE`)。
- 判断函数:`isRawPath(absPath, projectRoot)`、`isWritablePath(absPath, projectRoot)`。

`buildView.ts`、`kbHooks.ts`、`interaction.ts`、`agentHost.ts` 引用这些常量与函数,不再硬编码字符串。sub-seam 命名(Source/Compiled/Metadata/Reports)进 `CONTEXT.md`。

**为什么是单 module 而非按 sub-seam 拆多文件**:四条 sub-seam 各自只是路径常量 + 一行契约,拆四个文件是 premature structure(每个文件管少量常量)。单 `kbLayout.ts` 高内聚、200 行以内,是当前真实复杂度。deletion test:删了它,路径知识会重新散回三处 —— 它确实集中了复杂度。

**为什么不建描述对象供 prompt+代码共用**:prompt 需要的是自然语言说明(给 LLM 读),代码需要的是路径常量(给 TS 编译)。两者形态不同,强行共用一个对象会让 prompt 生成逻辑变复杂。YAGNI —— 让 prompt 文字和代码常量各自维护,sub-seam 名作桥。

### 决策 2:raw/ 只读走代码强制(tool_call 拦截)

在 `kbHooks.ts` 的 extension 里注册 `pi.on("tool_call")`,拦截 `write`/`edit` 工具对 `raw/` 路径的调用,返回 `{ block: true, reason: "raw/ 是只读源(raw/ is read-only Source)。如需修订内容,请写到 wiki/ 或 output/。" }`。

**为什么只拦 write/edit**:agent 可用写工具里,`write`/`edit` 的 input 有明确 `file_path`,路径判断可靠。`bash` 的 input 是 shell 命令字符串,解析它是否碰 raw/ 需正则匹配,会误伤 `cat raw/x`、`ls raw/` 这类读命令。agent 在本系统里写文件应走 write/edit(标准工作流),bash 主要用于读/检索。误伤成本 > 漏拦成本。

**为什么不在 prompt 里说就行**:prompt 是建议,代码是强制。raw/ 是源头数据,一旦被 agent 改写,后续 ingest 的"原始来源"语义就被破坏,且不可逆。block + reason 既阻止又让 agent 能自我纠正(改去 wiki/output)。这把 raw 只读从 gentlemen's agreement 升级为可执行契约。

### 决策 3:移除三个遗留概念

- **`raw/imported/`** 删除 —— 旧设计让转换产物住 raw 下,与 raw 只读矛盾。新架构:非 md 转换发生在上传端点(`/api/upload`),产物直接以 .md 落 `raw/`,不再有中间态。(非 md 转换实现本身留作后续任务,本 ADR 只定边界。)
- **`view/` 目录** 从 prompt 删除 —— 旧 Python 版静态站目录。可视数据现走 HTTP(ADR-0001),不落盘。
- **`pending/` 草稿区** 全移除 —— 从未在代码中被引用(仅 prompt 字符串与空物理目录存在)。sub-seam 从 5 条降为 4 条(Source/Compiled/Metadata/Reports)。物理目录删除。

## 测试边界(the interface is the test surface)

- `kbLayout.ts` 的 `isRawPath`/`isWritablePath` 纯函数单测:路径在 raw 下/不在/边界(`raw/x.md` vs `raw.txt` vs `wiki/raw-x.md`)。这是决策 1 的 seam 契约。
- `tool_call` 拦截逻辑不单测:需 mock pi 事件,成本高收益低。其正确性由 isRawPath 纯函数保证(拦截逻辑就是 `if isRawPath then block`)。与 ADR-0001 测试策略一致。

## 后果

- `kbHooks.ts` 新增 tool_call handler;`buildView.ts`/`interaction.ts`/`agentHost.ts` 改引 kbLayout 常量。
- `agentHost.ts` 的 `cwd` 改为 `KB_ROOT`;`createChatSession`/`createIngestSession` 的 sessionManager 路径调整。
- `prompt.ts` 更新:目录语义换成 sub-seam 名,删 `raw/imported/`、`view/`、`pending/` 相关段落。路径写法不变(相对 cwd=kb/)。
- 物理迁移:`mv raw wiki output index.md log.md kb/`;删 `pending/` 目录。
- 新建 `kb_example/`(入 git);`.gitignore` 把根目录的 `/raw /wiki /output /index.md /log.md` 改为 `/kb/`。
- `kbHooks.ts` 的 `detectKbChanges` 用 `git -C KB_ROOT status`,路径相对 kb/,正好只检测 layer1 变更。
- 非 md 上传转换仍待实现(端点仍只收 .md);本 ADR 只定其落点边界(转换后进 kb/raw/)。
- healthCheck 报告从 `output/health-check/` 提到 `kb/health-check/`(与 output 同级):它是 healthCheck 脚本的产物,非 agent 产物,不该住在 Reports 下。buildView 的 ad-hoc 排除规则(原 `abs.startsWith(exclude)`)随之删除 —— 不同性质的东西分到不同目录,排除规则自然消失。healthCheck.ts 写入路径改为 `kb/health-check/`。
