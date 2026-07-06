# PRD: z-wiki 桌面化(Electron + 不破坏三层)

- 状态:`ready-for-agent`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D1–D9,架构决策详情)
- 关联术语:`CONTEXT.md`「桌面形态」一节(Shell、嵌入式 server、UserDataDir、Vault、引导配置、Vault 内容、切换 Vault)

## Problem Statement

z-wiki 目前只能以开发者形态运行:`npm run dev` 同时起 Fastify server(127.0.0.1:3000)与 Vite dev server(:5173),所有运行时数据(`kb/`、`.pi/agent/`、`.env`)靠 `__dirname/../..` 推导,与代码目录绑死。这让普通用户无法使用——他们没有 Node 环境、不会命令行,且即便装了环境,代码与数据混在项目目录里,重装/迁移会丢失知识库。

用户需要的是一个**双击即用、跨平台(Windows/Linux/Mac)、重装不丢数据、数据可随知识库迁移**的桌面应用,同时不破坏 z-wiki 已落地的三层架构(layer1 `kb/` / layer2 `web` / layer3 `server`)与既定 seam(ADR-0001 的 AgentHost+Interaction、ADR-0002 的 layer1 契约)。

## Solution

将 z-wiki 包装为 Electron 桌面应用:Electron 主进程即 Node 运行时,直接在主进程内嵌入现有 Fastify server(in-process),随机端口监听 loopback;渲染进程(BrowserWindow)加载同一端口的 SPA,Fastify 同端口 serve 静态资源与 API,前端相对路径 fetch 零改造。

数据与代码物理分离:引入 UserDataDir(Electron `app.getPath('userData')`)存放引导配置(单一真相源 `config.json`:已知 Vault 列表、当前 Vault、API key、provider/model、全局偏好),pi 的 `models.json`/`auth.json` 降级为启动派生产物。每个知识库作为独立的 Vault(借鉴 Obsidian),用户可在设置里切换,一次只开一个。

桌面化作为**三层之外的第四个顶层模块** `desktop/`,单向依赖 `@z-wiki/server` 的窄接口(`createServer`/`buildAgentContext`),不穿透 kb/web/server 三层。

## User Stories

### 启动与运行

1. 作为普通用户,我想要双击一个可执行文件就能打开 z-wiki,这样我无需安装 Node 或用命令行。
2. 作为普通用户,我想要应用以独立窗口打开(不是浏览器标签页),这样它像一个真正的桌面应用。
3. 作为普通用户,我想要关闭窗口即停止应用,这样不会有遗留后台进程占用资源。
4. 作为普通用户,我想要应用在 Windows、Linux、Mac 上都能跑,这样我不被平台锁定。
5. 作为普通用户,我想要应用记住上次打开的窗口尺寸与位置,这样下次打开时回到熟悉的状态。
6. 作为普通用户,我想要应用启动后自动连接本地 server,这样我看到的页面内容总是最新的。
7. 作为开发者,我想要 `npm run dev` 仍像以前一样起 server+web 两个 dev server,这样桌面化不影响现有开发工作流。

### 首次启动与初始化

8. 作为普通用户,我想要首次启动时应用自动创建一个空知识库,这样我无需手动初始化目录结构。
9. 作为普通用户,我想要首次启动时被引导填入 Ark API key,这样 agent 能调用 LLM。
10. 作为普通用户,我想要 API key 存在本机且重启不丢,这样我不用每次输入。
11. 作为开发者,我想要首次启动从 bundle 内的 `kb_example/` 样板复制出初始 Vault,这样起步结构与开发形态一致。
12. 作为普通用户,我想要 API key 没填时,应用明确提示"未配置 key,agent 不可用",而不是静默失败。

### 知识库(Vault)管理

13. 作为用户,我想要在设置里看到当前打开的知识库路径与名称,这样我知道自己在哪个库里。
14. 作为用户,我想要在设置里切换到另一个已存在的知识库,这样我能分库管理工作/个人/项目内容。
15. 作为用户,我想要新建一个空知识库并切换过去,这样我能开一个全新的库。
16. 作为用户,我想要切换知识库时,当前对话上下文被清空(因为属于旧库),这样不会把旧库的上下文带到新库。
17. 作为用户,我想要切换知识库时,如果有上传正在处理(ingest),应用阻止切换并提示等待,这样不会出现状态分裂。
18. 作为用户,我想要切换知识库后,页面内容刷新为新库的文章列表,这样我看到的就是新库的内容。
19. 作为用户,我想要每个知识库的 agent 会话历史独立保存,这样切回某库时历史还在(虽然不续上下文)。
20. 作为用户,我想要知识库目录可以放在 UserDataDir 外的自定义位置(如 D 盘),这样大库不受系统盘限制。

### 设置与配置

21. 作为用户,我想要在设置页修改 Ark API key,这样 key 轮换时不用改文件。
22. 作为用户,我想要在设置页看到 provider/model 配置(首版只读展示 ark/ark-code-latest),这样我知道当前用的是哪个模型。
23. 作为用户,我想要设置改动持久化(重启后生效),这样配置不会丢。
24. 作为开发者,我想要所有配置以单一 `config.json` 为真相源,这样备份/迁移只需拷一个文件加 kb/ 目录。
25. 作为开发者,我想要 pi 的 `models.json` 在启动时从 config.json 生成、`auth.json` 不落盘,这样 pi 文件是派生产物、可丢可重建。

### Agent 与工具

26. 作为用户,我想要 agent 能读、写、编辑、搜索知识库文件,这样它能编译和维护我的知识库。
27. 作为用户(Windows),我想要 agent 的 grep/find 在我的机器上能跑,这样搜索功能可用,即使我没装 ripgrep/fd。
28. 作为用户(Windows),我想要应用不强制我装 Git Bash 也能用核心功能,这样普通用户零前置依赖。
29. 作为用户(Windows),我若装了 Git for Windows,我想要 agent 的可选 bash 工具自动可用,这样需要 shell 操作时能用。
30. 作为用户(中国/受限网络),我想要应用永不尝试联网下载工具二进制,这样不会因 GitHub 不可达而卡顿。
31. 作为开发者,我想要 agent 默认工具集不含 bash,这样收紧能力面、避免任意命令执行风险,且跨平台行为一致。

### 交互与体验

32. 作为用户,我想要拖拽文件到窗口上传到知识库,这样上传比点按钮选文件更顺手。
33. 作为用户,我想要应用有合理的原生菜单(mac 顶部菜单 / win 标题栏),这样符合平台习惯。
34. 作为用户,我想要应用在加载/agent 思考时有视觉反馈,这样我知道它在工作而非卡死。
35. 作为用户,我想要右键菜单符合桌面应用习惯(而非浏览器默认),这样体验更原生。
36. 作为开发者,我想要渲染层继续只走 HTTP/WS,不直接读本地文件,这样保持 layer2/layer3 的边界不变。

### 数据与持久化

37. 作为用户,我想要重装应用后知识库与配置不丢,这样升级不是风险。
38. 作为用户,我想要把整个知识库目录拷到另一台机器就能用,这样迁移简单。
39. 作为开发者,我想要 kb/ 与全局 agent 资源(models.json、bin/)物理分开,这样多 Vault 共享全局配置、不重复。
40. 作为开发者,我想要 rg/fd 二进制预打进 UserDataDir 的 bin 目录,这样 pi 优先用本地的、不下载。

## Implementation Decisions

> 以下为决策摘要,完整理由与备选排除见 `docs/adr/0003-desktop-form.md`。此 PRD 不重复 ADR 正文,只列交付所需的关键决策与契约。

### 架构约束(硬性)

- **不破坏三层**:`kb/`(layer1)/`web/`(layer2)/`server/`(layer3)物理边界、tsconfig、依赖不动。ADR-0001 的 AgentHost+Interaction seam、ADR-0002 的 layer1 契约(`kbLayout.ts` 集中定义、raw 只读走代码、buildView 走 HTTP 不写盘)原样保留。dev 形态(`npm run dev`)不受影响。
- **只改入口与路径来源,不改 seam 形状**:触及 `agentHost.ts`/`index.ts`/`interaction.ts` 时,改"入口怎么被调"和"路径常量从哪来",不改对外契约。

### 模块与接口

- **新增 `desktop/` 顶层 workspace 包**(与 `kb/`/`web/`/`server/` 平级):Electron 主进程入口、窗口管理、`PI_OFFLINE=1` 设置、首次启动从 bundle 铺放 rg/fd 到 pi 的 `getBinDir()`、调 server 启动。依赖方向单向:`desktop/` → `@z-wiki/server`,反向不存在。
- **`server/src/index.ts`** 从"启动即 listen"的 `start()` 重构为导出 `createServer()` 返回 Fastify app 实例(与现有 `createInteraction`/`buildAgentContext` 同级导出)。`desktop/` 只 import 这两个窄接口,不得深入 server 内部模块。
- **`server/src/agentHost.ts`** 的路径常量从"单一 PROJECT_ROOT 推导"改为"全局 dir + 当前 Vault dir 两路输入":
  - `KB_ROOT` → 当前 Vault 的 `kb/`(随 Vault 切换)。
  - `AGENT_DIR`(全局)→ UserDataDir 下的 `.pi/agent/`,含 `models.json`(启动生成)、`bin/`(预打进 rg/fd)。
  - `MODELS_JSON` → 启动时从 `config.json` 的 provider/model 字段生成,喂 `ModelRegistry`。
  - `kbLayout.ts` **签名不动**(已是 `kbRoot(projectRoot)` 参数化),只改调用方传入的值。
- **`server/src/interaction.ts`** 新增:
  - `POST /api/vault/switch` 端点(带目标 Vault 路径,查活跃 ingest → 409 或 200 + 切换)。
  - `vault_changed` WS 事件(切库时推给所有 chatClients,带新 Vault 元信息)。
  - 活跃 ingest 状态暴露(布尔/计数,供切库前检查)。
- **`server/src/agentHost.ts`** tools 数组去掉 `"bash"`(默认 `["read","edit","write","grep","find","ls"]`)。

### 数据目录契约

- **引导配置**(`UserDataDir/config.json`,单一真相源):已知 Vault 列表 + 当前打开项、API key、provider/model、全局偏好。
- **pi 文件为派生产物**:`models.json` 启动生成;`auth.json` 不落盘,API key 经 `setRuntimeApiKey` 运行时注入。
- **Vault 内容**(随 Vault):`kb/`(layer1 全部)+ 该 Vault 的 agent 会话历史(`sessions/`)。
- **首次起步**:UserDataDir 空时,从 bundle 内 `kb_example/` 复制到首个 Vault 路径。
- **rg/fd 铺放**:bundle 内 `resources/bin/<platform>-<arch>/`,首次启动复制到 `UserDataDir/.pi/agent/bin/`(pi 的 `getToolPath` 优先查此),带版本号,不一致则重新铺放。

### 运行时编排

- **server in-process**:Electron 主进程 import `createServer()`,`app.listen({port:0})` 取随机端口,主进程把端口经 IPC/`loadURL` query 注入渲染进程。渲染进程 `loadURL('http://127.0.0.1:<port>/')`。
- **前端同端口 serve**:server 加 `@fastify/static` serve `web/dist`,SPA + API 同源(前端已用相对路径 `fetch('/api/...')`,零改)。
- **`PI_OFFLINE=1`**:主进程启动时设,在 `buildAgentContext` 之前,禁用 pi 下载分支。

### 切库闭环

1. 设置页发 `POST /api/vault/switch`。
2. server 查活跃 ingest → 有则 409。
3. 无 → 更新当前 Vault 路径 → 推 `vault_changed` → `socket.close()` 所有 chatClients(复用现有 `on("close")` 的 `session.dispose()`,不新写 session 关闭代码)。
4. 重建 buildView。
5. 前端识别 `vault_changed`(非崩溃重连)→ 清空消息 → 重连 WS(新 KB 路径)→ 重拉 `/api/pages`。
- agent context(`buildAgentContext`)是全局单例,不随切库重建;只重建 chat session。

### 配置 schema 决策(首版)

- `config.json` 首版 provider/model 写死 `ark`/`ark-code-latest`,设置页只暴露"填 API key"。多 provider 可选是未来产品决策,不在此 PRD(扩 schema 即可,不破坏架构)。

## Testing Decisions

### 测试理念

- **只测外部行为,不测实现细节**。测试应通过公开接口(HTTP 端点、纯函数返回值)验证行为,不 assert 内部状态/私有函数。
- **优先复用现有 seam,不新增**。现有 `server/src/*.test.ts` 测纯函数(`buildView`/`hasIndexChanged`/`kbLayout`),本 PRD 延续此风格,只在必要时升到 HTTP 层。

### Seam(2 个,均为现有风格延伸)

**Seam 1:HTTP 层 `app.inject()`(主 seam)**

- 用 Fastify 原生 `app.inject()` 跑 HTTP 请求(不起真实端口)。覆盖:
  - `/api/vault/switch`:切库请求 → 409(活跃 ingest)/ 200(成功)→ 验证后续 `/api/pages` 返回新 Vault 内容。
  - `vault_changed` WS 事件:WS 客户端连上验证推送。
  - 活跃 ingest 状态:上传中调 switch → 409。
  - `createServer()` 导出:import 后 `app.inject('/api/health')` 验证返回。
- **为何最高**:切库/端点是编排行为,纯函数测不了;`app.inject()` 是 Fastify 推荐的集成测试方式,不起端口、快、隔离。

**Seam 2:纯函数生成器**

- `generateModelsJson(config)` 纯函数:输入 config.json 的 provider/model 字段,输出 models.json 内容。测输入产出。与现有 `buildView.test.ts` 同风格。
- `kbLayout.ts` 不新增测试(签名不变,已有 `kbLayout.test.ts`)。

### 不在自动化覆盖内(手动验证 + 写入 Further Notes)

- Electron 主进程窗口生命周期、`PI_OFFLINE=1` 设置、rg/fd 铺放——shell 行为无现成 seam,首版手动验证。
- 跨平台打包产物(win/mac/linux 可运行)——靠 electron-builder 产物 + 手动跑。

### Prior art(现有测试参照)

- `server/src/buildView.test.ts` —— 纯函数 + 临时目录造 fixture 的风格,Seam 2 沿用。
- `server/src/kbLayout.test.ts` —— 路径契约断言,改路径常量时确保不破坏。

## Out of Scope

- **多 provider 可选**:首版只支持 ark/ark-code-latest,设置页不暴露 provider 切换。未来扩 `config.json` schema,不破坏架构。
- **代码签名与公证**:mac notarization(Apple Developer $99/年)、Win 代码签名证书是发布期投入,非此 PRD 范围。首版可分发未签名产物(用户手动信任)。
- **自动更新**:electron-updater 策略待定,首版不做,不影响可运行。
- **lint 清理**:biome 接入后既有 22 errors(a11y、`!` 断言等)是独立代码健康工作,走单独 issue,不混入桌面化。
- **便携版(portable)**:数据跟 app 包走、U 盘即插即用——首版不做,UserDataDir 安装版优先。
- **多窗口/多 Vault 同时开**:首版一次只开一个 Vault、一个窗口。
- **bash 工具的捆绑 Git Bash**:不捆绑,靠用户自备 + pi 自探测。捆绑的体积/许可代价不值。
- **非 md 上传转换**:沿用 ADR-0002 既定边界(端点转 md 落 raw/),不在桌面化范围内扩展。

## Further Notes

- **首刀实现顺序**(依赖链):① D3 `agentHost.ts` 路径重构(两路输入 + models.json 启动生成);② D2 `index.ts` 拆 `createServer()` 并显式导出;③ D6 tools 去 bash;④ 新建 `desktop/` 包(Electron 主进程 + rg/fd 铺放 + 切库端点 + 设置页)。
- **实现期 spike(非阻塞架构)**:验证 pi 的 rg/fd 在 Electron 打包后真能从 `getBinDir()` 加载(已预打进 + `PI_OFFLINE=1`,理论上必走本地,但需在 win/mac/linux 各跑一次确认)。
- **pi 源码关键事实(已验证,实现时参考)**:
  - `getShellConfig()`(utils/shell.js):win 找 `Program Files\Git\bin\bash.exe` → PATH → 抛错;支持 `shellPath` 覆盖。
  - `getToolPath()`(utils/tools-manager.js):优先 `getBinDir()`(=`<agentDir>/bin`)→ PATH → 下载。
  - `PI_OFFLINE=1` 禁下载分支。
  - `grep/find` spawn rg/fd(`ensureTool` 支持自动下载,但 `PI_OFFLINE` 下走预打进)。
  - `ls/read/edit/write` 纯 Node fs,跨平台零依赖。
- **chat session 模型修正**:现有 `interaction.ts:194-229` 注释"常驻"为误导,实际 per-WS-connection(每连接 createChatSession + 断开 dispose)。切库复用此机制,不为切库改单例。
- **未提交状态**:biome 接入 + ADR-0003 + agent skills 配置已 commit(`beade4f`)。lint 清理分叉为独立 session(handoff 文档在系统临时目录)。
- **风险**:Electron 打包是本项目首次接触,electron-builder 配置(extraResources 按平台过滤 rg/fd、workspaces 构建顺序、mac universal/arm64)需在实现期调通,不阻塞架构。
