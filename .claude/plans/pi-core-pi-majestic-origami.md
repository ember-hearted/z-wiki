# pi-wiki:基于 pi-coding-agent 的独立 LLM+Wiki 知识库系统

## Context

用户在 `/Users/a1/Documents/share_wsl` 有一套基于 Obsidian + Claude Code 的 LLM+Wiki 知识库:CLAUDE.md 作为系统提示词定义工作流(Query/Ingest/Build/Lint),`.claude/settings.json` 两个钩子(UserPromptSubmit 注入知识库模式引导、Stop 提醒 log+build),Python 脚本做 md→html 构建和健康检查,`view/` 是 React+Vite 渲染层。

用户要做的是**全新独立项目**(当前目录 `/Users/a1/workspace/z-wiki`),借鉴 share_wsl 的驱动思路但**不依赖 Obsidian/obsidian-cli/Claude Code**,改用 pi 作为驱动核心,做成网页(将来可套壳成桌面 app 供自己开箱即用,不发布)。核心诉求:用户面对的是界面不是文件夹;上传文件自动触发智能体全链路编译;对话与知识库在一个产品里闭环。

本 plan 是 grilling 会话产出的架构决策汇总,用于指导后续实现。

## 已确认的技术可行性(均经文档核实)

- **pi-coding-agent SDK 可单进程嵌入**:`createAgentSession()` 工厂返回独立 session,`session.subscribe()` 拿事件流(`text_delta`/`tool_execution_*`/`agent_end` 等),`session.prompt()` 注入。无需 TUI、无需子进程。
- **输入注入**:`input` 事件支持 `transform`(改输入文本)/`handled`(跳过 agent),语义和时机对应 Claude Code UserPromptSubmit。
- **回合结束副作用**:`agent_end` 事件可跑 git 检测、通知、触发脚本。
- **多并发 agent 会话**:`createAgentSession()` 是无状态工厂,可同进程造多个独立 session(对话 agent + 后台 ingest agent),共享同一份 `modelRegistry`/`DefaultResourceLoader`(system prompt/extensions/tools),会话历史和事件流各自隔离。
- **system prompt / extension / skill 注入**:`DefaultResourceLoader({ systemPromptOverride, extensionFactories, skillsOverride })`。
- **会话持久化**:`SessionManager` JSONL。

## 架构决策

| 决策点 | 选定方案 | 理由 |
|---|---|---|
| 运行时层 | **pi-coding-agent**(非裸 pi-agent-core) | 复用其扩展系统/skills/会话/内置工具,直接对应 Claude Code 驱动模型 |
| 后端进程模型 | **SDK 单进程嵌入(B 方案)** | 自己用、不发布,无需进程隔离;少一层 IPC,调试简单 |
| 后端框架 | **Fastify + @fastify/websocket** | TS 原生,与 pi SDK/前端统一语言栈,WebSocket 插件成熟 |
| 前端 | **复用 share_wsl/view 的 React 19 + Vite 6 + react-router 7** | Article 渲染、useData 可直接搬;three/gsap 书架可选保留 |
| 界面布局 | **对话 / 知识库 切换 tab**(非同屏并列) | 每区给足空间;闭环实时性靠 Q12 自动刷新补 |
| CLAUDE.md 落点 | **改写为 pi systemPromptOverride 的值(不保留 CLAUDE.md 文件)** | CLAUDE.md 是 Claude Code 开发期产物,新项目不留;内容改写后直接作为 `systemPromptOverride` 注入 pi agent。清掉 obsidian-cli/硬编码路径/Claude Code skill 引用;保留工作流骨架 + `[[...]]` wikilink 语法;路径相对 cwd |
| 钩子迁移 | **1:1 迁移到 pi extension** | UserPromptSubmit→`input` 事件(transform 注入引导语);Stop→`agent_end`(先 1:1 检测变更通知,不自动 build) |
| 脚本运行时 | **核心脚本 TS 重写,删 Python 依赖** | build/healthCheck 用 TS(零 Python);import-non-md 删除(上传限制 .md);start-view 删除(并入 Fastify) |
| 上传模型 | **上传自动触发后台 ingest agent 全链路** | raw 不可见;上传 .md→自动归档 raw→后台 agent Ingest→wiki→(条件)output |
| 后台任务 | **C 方案:独立后台 agent + 结果回流对话** | 后台不阻塞对话;agent_end 推 WebSocket→对话插"已编译 wiki《X》" |
| 闭环刷新 | **agent_end 自动 build + WebSocket 推刷新** | agent 写完 wiki→自动跑 TS buildView→推"知识库已更新"→前端重拉 pages.json |
| 内容分层 | **用户只见 成品(wiki/output 渲染)+ 对话;raw 是后端实现** | view=渲染层(非内容层);"查看原文"看 md 源;raw 仅后端 |
| 项目位置 | **`/Users/a1/workspace/z-wiki`**(当前目录) | 干净空地 |

## 目录结构(新项目)

```
z-wiki/
├── package.json                  # workspace 根(管理 server + web)
├── tsconfig.json
├── .pi/
│   └── extensions/
│       └── kb-hooks.ts           # input 事件(注入引导) + agent_end(检测变更/触发build/通知)
├── server/                       # Fastify 后端 + pi SDK
│   ├── src/
│   │   ├── index.ts              # Fastify 启动,托管静态产物 + WebSocket
│   │   ├── agent.ts              # 封装 createAgentSession:对话 agent + 后台 ingest agent
│   │   ├── ws.ts                 # WebSocket 事件桥(pi 事件 → 前端)
│   │   ├── upload.ts             # /upload 端点:接收 .md → 归档 raw/ → 触发后台 ingest
│   │   └── build.ts              # TS 版 buildView(替代 build-view.py)
│   └── tsconfig.json
├── web/                          # React 前端(从 share_wsl/view 搬来)
│   ├── src/
│   │   ├── App.tsx               # 顶层 tab:对话 / 知识库
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx     # 新增:对话面板(流式 token + 工具调用展示)
│   │   │   ├── Article.tsx       # 搬:文章渲染(加"查看原文"切换 md/渲染)
│   │   │   ├── Home.tsx          # 搬:知识库列表
│   │   │   └── ...               # BookShelf3D 等可选搬
│   │   └── hooks/
│   │       ├── useData.ts        # 搬:拉 pages.json(加自动刷新)
│   │       └── useChat.ts        # 新增:WebSocket 对话
│   └── package.json
├── scripts/                      # TS 脚本(替代 Python)
│   └── healthCheck.ts            # 合并 share_wsl 4 个重复健康检查脚本
├── raw/                          # 后端实现,用户不可见(上传归档于此)
├── wiki/                         # LLM 产出的结构化知识
├── output/                       # LLM 产出的报告/分析
├── view/                         # buildView 生成的 pages.json + pages/*.html(渲染数据)
├── index.md                      # 内容目录(LLM 维护)
└── log.md                        # 操作日志
```

## 实现要点

### 1. 系统提示词改写(pi 适配,注入 systemPromptOverride)
- 取 share_wsl/CLAUDE.md 内容为蓝本,改写后作为 `DefaultResourceLoader({ systemPromptOverride: () => "..." })` 的值。新项目不保留 CLAUDE.md 文件。
- 删除:`obsidian-cli` 搜索规则→改"用 grep/find/ls 内置工具";`/ob-health-check` skill→改 pi extension command;硬编码 `/Users/a1/Documents/share_wsl`→相对 cwd。
- 保留:Query/Ingest/Build/Lint 工作流骨架、目录语义、编译规则、`[[NN-主题名]]` wikilink 语法、命名规范、index/log 维护节奏、`view: true/false` 打标。
- Build 命令从 `python3 scripts/build-view.py` 改为 TS buildView(后端 import 调用)。

### 2. kb-hooks.ts extension
- `pi.on("input")`:正则未命中"外部知识/联网"等关键词→`return { action: "transform", text: 原文 + 引导语 }`(路径相对 cwd)。
- `pi.on("agent_end")`:第一阶段 1:1——git status 检测 wiki/raw 变更→通知;后续增强——自动跑 buildView + 推 WebSocket 刷新(Q12)。

### 3. 后端 agent.ts(双 agent)
- 共享一份 `DefaultResourceLoader`(CLAUDE.md system prompt + kb-hooks extension + 工具)、`modelRegistry`、`authStorage`。
- 对话 agent:常驻 session,前端 WebSocket 来消息→`session.prompt()`→事件流推前端。
- 后台 ingest agent:每次上传 `createAgentSession({ sessionManager: 独立 jsonl })`→`prompt("已上传 X,按 Ingest 工作流编译")`→`agent_end` 推"已编译 wiki《X》"到对话 + 触发 build 刷新。
- 文件并发写:wiki/output 写操作加简单写锁(按文件串行),避免双 agent 同时写冲突。

### 4. 上传与 raw
- `/upload` 端点:只接受 `.md`,写入 `raw/<原命名>`,立即触发后台 ingest agent。raw 不暴露任何前端浏览接口。

### 5. TS buildView(替代 build-view.py)
- 读 wiki/ + output/(`view: true`),md→html,生成 `view/public/pages.json` + `pages/*.html`。
- jinja2 模板→TS 模板字符串(需读 build-view.py 模板部分确认复杂度,若条件/循环多则上 handlebars,否则纯字符串)。
- 后端 import 调用,agent_end 自动触发,毫秒级。

### 6. 前端
- 顶层 tab:对话 / 知识库(切换,非并列)。
- ChatPanel:WebSocket 订阅,流式渲染 `text_delta`,工具调用过程展示。
- Article:加"查看原文"按钮,切换 渲染页(view html)/ 原文(md 源)。
- useData:拉 pages.json,收到 WebSocket"知识库已更新"事件后重拉刷新。

## 待实现时确认的细节(不阻塞 plan)

- build-view.py 模板复杂度 → 决定 TS 用模板字符串还是 handlebars。
- pi 的 `agent_end` 事件能否拿到本轮文件改动列表(决定 log 自动追加的摘要来源)。
- 后台 ingest agent 的并发上限(多文件同时上传时排队还是并行)。

## 验证方式

1. **后端起得来**:`npm run dev` 起 Fastify,日志显示 pi session 创建成功、modelRegistry 加载、extension 注册。
2. **对话闭环**:前端对话 tab 发"解释 RAG"→流式 token 显示→agent 调 read 工具读 wiki→回答→(若回写)agent_end 触发 build→切到知识库 tab 看到新文章。
3. **上传闭环**:前端上传一个 .md→后端归档 raw→后台 ingest agent 跑→对话 tab 出现"已编译 wiki《X》"→知识库 tab 自动出现该文章。
4. **钩子生效**:对话输入不含"联网"关键词→日志/上下文显示引导语已注入(input transform);agent_end 后 log.md 有追加、build 已跑。
5. **零 Python 依赖**:全新环境只装 Node,上述流程全部跑通(无 python3/markitdown 调用)。
6. **TS 健康检查**:`npm run health` 跑 TS 版,输出断链/孤儿/空文件报告,结果与原 Python 版一致。

## 建议的实现顺序

1. 项目脚手架:workspace + server + web 目录,搬 view 前端,起 Fastify 托管静态产物。
2. pi SDK 接入:agent.ts 起一个对话 agent,WS 桥通,前端 ChatPanel 能聊天(最小闭环)。
3. 系统提示词改写(注入 systemPromptOverride)+ kb-hooks extension(input 注入 + agent_end)。
4. TS buildView + useData 自动刷新(知识库 tab 能看文章)。
5. 上传端点 + 后台 ingest agent(上传闭环)。
6. TS healthCheck(替代 Python)。
7. 文件写锁、并发、错误处理打磨。
