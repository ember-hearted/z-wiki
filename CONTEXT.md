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

## server 内部 seam

详见 ADR-0001。两个 module:

- **AgentHost**(`agentHost.ts`)—— pi SDK 全部封装。不知道 web/HTTP/广播。
- **Interaction**(`interaction.ts`)—— 外部接入 + 业务编排。通过 AgentHost 窄 interface 碰 agent。
