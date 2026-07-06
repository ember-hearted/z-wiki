# CONTEXT.md — z-wiki 领域词汇表

z-wiki 的领域语言。架构评审用这些词指代概念,不要漂移成 "service"/"component"/"api"。
架构词汇(module/interface/depth/seam/adapter/leverage/locality)见 `/codebase-design` skill。

## 三层架构

z-wiki 分三层。每层有独立的契约,层间经窄 interface 通信,不互写文件系统。物理上 layer1 收拢在 `kb/` 目录。

- **layer1 知识层(data)** —— 知识库本身的内容,集中在 `kb/`。agent 全权维护,server 只读(除上传归档)。agent 的 cwd = `kb/`,物理上看不到 server/web。
- **layer2 可视层(web)** —— 前端 SPA,运行时经 HTTP fetch layer3 暴露的可视数据。
- **layer3 交互层(server)** —— Fastify + pi agent。用户与 LLM 交互的唯一渠道;编排 ingest/agent_end→build 闭环。

## layer1 的四条 sub-seam

layer1 集中在 `kb/` 下,内部按内容性质分四条 sub-seam。每条有独立的路径与契约,代码层由 `kbLayout.ts` 集中定义。agent 的 cwd 是 `kb/`,以下路径均相对 `kb/`。

| sub-seam | 路径(相对 kb/) | 契约 |
|---|---|---|
| **Source** | `raw/` | 只读源。原始来源(含从非 md 转换而来的 .md)。agent 读取但永不修改;唯一写入方是上传端点归档。代码层由 tool_call 拦截强制(ADR-0002) |
| **Compiled** | `wiki/` | agent 维护的结构化知识。`view: true` 的文章进入可视层 |
| **Metadata** | `index.md`, `log.md` | 索引(`index.md`)与操作时间线(`log.md`)。每次有产出的 ingest/query 后追加 |
| **Reports** | `output/` | agent 生成的报告与分析 |
| **(工具产物)** | `health-check/` | healthCheck 脚本生成的健康检查报告。与 output/ 同级,不进可视层,不归 agent 维护 |

`kb/` 整个 gitignore(内容由 agent 维护);项目根有 `kb_example/` 纯结构样板供新人 `cp -r kb_example kb` 起步。

### 已移除的概念

- `raw/imported/` —— 旧 Obsidian 设计(非 md 转换产物住 raw 下)。新架构里转换发生在上传端点,产物直接落 `raw/` 为 .md,不再有此子目录。详见 ADR-0002。
- `view/` 目录 —— 旧 Python 版的可视静态站目录。可视数据现走 HTTP(ADR-0001),不落盘。
- `pending/` —— 草稿区。实际未使用,已从代码与目录中移除。

## 关键工作流

- **Ingest** —— 上传源到 `raw/`(经界面上传,非 md 在端点转 md)→ agent 按 §1 编译规则处理 → 更新 Compiled + Metadata → 触发 build
- **Query** —— 用户提问 → agent 读 Metadata 定位 → 读 Compiled/Source 合成回答 → 判断回写 → 更新 Metadata
- **Build** —— agent 回合结束后,server 调 `buildView` 纯函数扫 Compiled(`view:true`)+ Reports → 内存缓存 → 经 HTTP 暴露给 layer2

## 桌面形态

z-wiki 桌面化引入的概念。仅领域语言,实现细节见 ADR-0003。

桌面化是在三层之外加一层 shell + 编排,不破坏现有三层(`kb/`/`web/`/`server/`)的物理边界与内部 seam(ADR-0001/0002)。

- **Shell(壳)** —— 把 web SPA 装进原生窗口、管理进程生命周期的那一层(Electron)。不是 server,也不是 web。物理上独立成 `desktop/` 顶层包,与三层平级,单向依赖 `@z-wiki/server` 的窄接口。
- **嵌入式 server** —— 现在的 Fastify layer3,在桌面形态下不再独立 `app.listen` 暴露给外部,而是被 shell 拉起、可能只在 loopback 甚至进程内服务。
- **UserDataDir** —— 跨平台可写的 per-user 目录(Electron `app.getPath('userData')`),存放引导配置与全局 agent 资源。与 app bundle(只读)严格分开。
- **引导配置** —— app 自身启动所需、与具体 Vault 无关的配置:已知 Vault 列表 + 当前打开项、API key、provider/model、全局偏好。固定落在 UserDataDir,真相源为单一 `config.json`,pi 的 `models.json`/`auth.json` 为其派生产物。
- **Vault(知识库实例)** —— 一个可被"打开"的 `kb/`。同一台机器上可有多个 Vault(工作库/个人库/项目库),设置里切换。一次只开一个。
- **Vault 内容** —— 随 Vault 走的部分:`kb/`(layer1 全部)与该 Vault 的 agent 会话历史。
- **切换 Vault** —— 改"当前打开哪个 kb/",不是搬数据。切库即重启 agent context + rebuild view,当前对话上下文作废。

## server 内部 seam

详见 ADR-0001。两个 module:

- **AgentHost**(`agentHost.ts`)—— pi SDK 全部封装。不知道 web/HTTP/广播。
- **Interaction**(`interaction.ts`)—— 外部接入 + 业务编排。通过 AgentHost 窄 interface 碰 agent。

## 主题(layer2 可视层外观)

z-wiki 的视觉外观有两套主题,共享同一套靛青 accent 与工业骨架,基底明暗反转。纯阅读偏好,不进 server 单一真相源,存 localStorage。

- **Archive(暗)** —— 现有深色工业档案风主题。温润深底 + 低饱和靛青 + 档案展台调性;首页 3D 书架画布恒为深色展台(即使切到 Draft,书架区仍保持深色舞台)。
- **Draft(浅)** —— 冷蓝图纸风浅色主题。浅灰冷底 + 深石板字 + 原子化空心边框,呼应工业图纸/仪表盘底。与 Archive 同 accent,切换时品牌色不断裂。
- **主题开关** —— header 设置按钮右侧的 pill 滑动开关(月左日右),无文字、纯图标,控制明暗切换。a11y 对齐项目自定义控件基准(`role="switch"`+键盘)。
