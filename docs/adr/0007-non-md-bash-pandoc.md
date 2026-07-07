# ADR-0007: 非 md 上传走 bash+pandoc —— 原文件留 raw/、转换在 agent 侧、bash 白名单限定

- 状态:accepted
- 日期:2026-07-07
- 范围:非 md 文件上传的转换路径、agent bash 工具的引入与约束、pandoc 二进制内置分发。**supersedes ADR-0002 决策 3(端点前置转换)的"端点前置"部分,保留其"不留中间态"精神;extends ADR-0003 D6(默认去掉 bash)为"bash 作为文档解析专用 + 命令白名单限定"**。
- 关联:ADR-0002(被取代决策 3)、ADR-0003(被扩展 D6)、CONTEXT.md

## 背景

ADR-0002 决策 3 定:"非 md 转换发生在 `/api/upload` 端点,产物直接以 .md 落 raw/,不留中间态",但转换实现留作后续任务。当前 `/api/upload` 仅收 .md(`interaction.ts:308`)。本轮落地非 md 支持。

核心分叉是 raw/ 的语义模型:

- **端点前置转换**(决策 3 现状):raw/ = 已标准化的 md 源头。原文件丢失,转换质量入库固化,换转换器要重新上传存量。
- **agent 侧按需转换**(本 ADR):raw/ = 原始源头(原格式)。转换在 agent 工具内联,原文件保留,转换器可迭代(换 pandoc 版本自动惠及存量)。

选后者:原文件保真是知识库本职(raw/ 该是原始来源,不是加工产物);转换可迭代是长期红利。raw/ 的"只读源头"语义(ADR-0002 决策 2 花力气保护的)也因此更自洽——保护的是真源头,不是加工产物。

## 转换器选型

评估四条路:

- **markitdown(Python 子进程)**:覆盖广但引入 Python 运行时,Electron 桌面打包重。
- **officeParser(纯 JS customTools)**:纯 JS、Electron 友好,但质量待验证、需自己写 ToolDefinition。
- **自己写 TS 版 markitdown**:重做 officeParser 做过的事(封装 Node 解析库 + 转 md 胶水),从零开始,天花板相同(受限于 Node 生态底层库)。
- **bash 调 pandoc + 内置二进制**:复用 pi 内置 bash 工具,白名单收窄风险面,pandoc 质量成熟(15 年迭代,office 三件套原生输入支持)。

选 bash+pandoc:pandoc 覆盖广(office 三件套 + odt/epub/html/rtf/csv/json/xml/org/rst 等,`--from=` 原生支持 docx/xlsx/pptx,无 experimental 标注);复用 pi bash 不写 customTool;白名单限定 bash 只跑 pandoc/cat,化解 D6 的 rm -rf 顾虑。

pi 的 `ensureTool` 硬编码 `"fd" | "rg"`(`utils/tools-manager.d.ts:2`),不能复用给 pandoc,pandoc 下载管理需自行实现。

## 决策

### 决策 1:非 md 原样落 raw/,转换在 agent bash 内联(supersede ADR-0002 决策 3)

`/api/upload` 去掉"仅 .md"校验,改为 pandoc 支持的后缀白名单(.md/.docx/.xlsx/.pptx/.odt/.epub/.html/.rtf/.csv/.json 等,见决策 5 的 pdf 例外)。非 md 原样落 raw/。转换不落盘——agent 用 bash 调 `pandoc raw/x.docx -t markdown` 在内存拿文本,不写中间 .md 到 raw/。保留决策 3 删 `raw/imported/` 的精神(无转换产物住 raw),只改转换时机(端点前置 → agent 按需)。

### 决策 2:bash 作为文档解析专用,命令白名单限定(extend ADR-0003 D6)

D6 决策 1"默认去掉 bash"调整为:bash 作为文档解析专用能力加回工具集,但仅限文档解析。bash 不走字符串 `AGENT_TOOLS`(pi 默认 bash 无配置入口),而经 `customTools: [createBashToolDefinition(cwd, { spawnHook })]` 注册——spawnHook 用于注入 pandoc bin 目录到 PATH(决策 3)。在 kbHooks 的 `tool_call` 事件里对 bash 做白名单(`ToolCallEventResult.block` 物理拦截,pi 注释"Block tool execution"):

- 只放行 `pandoc`/`cat` 开头的单条命令
- 禁止 shell 元字符(`;` `&&` `||` `|` `$()` `` ` `` `>` `<`),防止 `pandoc x; rm -rf` 绕过
- 非白名单 → `{ block: true, reason }`

bash 风险面从"任意命令"收窄到"pandoc/cat 白名单",化解 D6 决策 1 的 rm -rf 顾虑。agent 工具集里只有 bash 能跑命令,管住 bash 即管住命令执行面(`read` 读文件不危险,`write`/`edit` 撞 raw/ 已被 kbHooks 拦,`grep`/`find`/`ls` 只读)。

### 决策 3:pandoc 二进制按平台内置(自行实现下载管理)

自行实现 pandoc 下载管理(仿 `ensureTool` 思路但针对 pandoc):查平台 → 从 jgm/pandoc GitHub releases 下载对应便携包(linux tar.gz / macos zip / windows zip,单平台 24-40MB)→ 解压到 UserDataDir/bin → bash 的 `BashSpawnHook`(`bash.d.ts:49`)注入该目录到 `env.PATH`。

开发形态:首次解析时按需下载(或文档提示 `brew install pandoc` 自备)。桌面形态:按平台打包时把该平台 pandoc 二进制放进 `extraResources`,免运行时下载。

### 决策 4:pandoc 内置而 Git Bash 自备(回应 D6 决策 4)

D6 决策 4 不捆绑 Git Bash 的理由:80MB 体积 + GPLv3 灰区 + MSYS2 路径坑。pandoc 内置逐项对比:

| D6 顾虑 | Git Bash | pandoc 内置 |
|---------|----------|-------------|
| 体积 | 80MB | 24-40MB(更小) |
| 许可 | GPLv3 灰区 | GPL-2.0(同类 copyleft,稍宽松) |
| 路径坑 | MSYS2 路径转换 | 单二进制,无坑 |

区分理由:pandoc 是非 md 方案的**核心依赖**(非可选能力)、体积更小、无路径坑,故内置;Git Bash 是可选通用 shell,体积大、有路径坑,故自备。

pandoc 是 GPL-2.0(gh 确认,`licenseInfo.key: gpl-2.0`)。作为独立二进制被 spawn(不链接进 z-wiki 进程),GPL 不传染主程序代码。内置分发尽的义务:about/credits 页保留 pandoc 许可声明 + 提供 jgm/pandoc 源码链接。

### 决策 5:pdf 暂不支持

pdftotext(poppler)无官方跨平台静态二进制,内置成本高(pdf 是 bash+pandoc 方案的软肋;pandoc 不支持 pdf 输入)。本轮不含 pdf,单独方案待定(候选:接受靠系统 pdftotext / server 端 pdfjs 预转 / mutool 但 AGPL 风险)。`/api/upload` 白名单不含 .pdf,前端 accept 不含 .pdf,后端遇 .pdf 回 415 提示"pdf 暂不支持"。

## 后果

- **ADR-0002 决策 3 被取代**:raw/ 语义从"已标准化 md 源头"改为"原始源头(原格式)",raw/ 不再同质(混 md/非 md)。`buildView` 遍历 raw/ 要适配(跳过非 md 或按后缀区分对待)。
- **ADR-0003 D6 扩展**:`AGENT_TOOLS` 加回 bash;kbHooks 加 bash 白名单拦截;新增 pandoc 下载管理模块 + spawnHook 注入 PATH。
- **`/api/upload`**:校验从"仅 .md"改为"pandoc 支持后缀白名单"(pdf 除外)。
- **前端 `ChatPanel.tsx:255`**:`accept=".md"` 改为 pandoc 支持后缀白名单(pdf 除外),与后端校验一致。
- **ingest prompt**:引导 agent 对非 md 用 `pandoc raw/x.docx -t markdown` 读文本,而非 `read`(`read` 读非 md 拿二进制乱码);可选在 kbHooks 拦 `read` 对非 md 后缀,提示改用 bash pandoc。
- **桌面打包**:按平台内置 pandoc 二进制(单平台增量 ~24-40MB)+ GPL 声明页。
- **重复解析**:bash 每次调 pandoc 都重新转换,无缓存。单次 ingest 只读一次可接受;若对话 agent 也引用 raw/ 非 md,后续可加 mtime 缓存。
- **许可**:about/credits 页加 pandoc GPL-2.0 声明 + 源码链接。

## 测试边界

- **bash 白名单纯函数单测**:白名单命令放行(`pandoc raw/x.docx -t markdown`)、含元字符 block(`pandoc x; rm -rf`、`pandoc x | grep`、`$(rm)`)、非白名单命令 block(`rm -rf`、`cat /etc/passwd`)。这是决策 2 的安全边界。
- **pandoc 下载管理单测**:mock GitHub API + 本地解压,验证按平台选 asset + 解压到正确路径。
- **`/api/upload` 后缀白名单**:各后缀放行 + 非白名单(含 .pdf)415。
- **bash 实际解析端到端**:跳过(pi bash + pandoc 二进制,集成测试成本高,安全边界靠白名单单测保证)。
