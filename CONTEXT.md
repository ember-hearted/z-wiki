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
| **Source** | `raw/` | 只读源。原始来源原样归档(不预转),agent 读取但永不修改;唯一写入方是上传端点。读法三分:md 与纯文本(.txt/.text/.log)原样 read,pandoc 格式(docx 等)经 pandoc 工具转文本。代码层由 tool_call 拦截强制(ADR-0002/0011/0016) |
| **Compiled** | `wiki/` | agent 维护的结构化知识。文章进入可视层(导航页 `00-知识库导航` 除外,ADR-0010) |
| **Metadata** | `index.md`, `log.md` | 索引(`index.md`)与操作时间线(`log.md`)。每次有产出的 ingest/query 后追加 |
| **Reports** | `output/` | agent 生成的报告与分析 |
| **(工具产物)** | `health-check/` | healthCheck 脚本生成的健康检查报告。与 output/ 同级,不进可视层,不归 agent 维护 |

`kb/` 整个 gitignore(内容由 agent 维护);项目根有 `kb_example/` 纯结构样板供新人 `cp -r kb_example kb` 起步。

### 已移除的概念

- `raw/imported/` —— 旧 Obsidian 设计(非 md 转换产物住 raw 下)。新架构里非 md 原样落 `raw/`(不预转),转换在 agent 侧经 bash pandoc 按需进行,不再有此子目录。详见 ADR-0002(决策 3 定边界)/ ADR-0007(改转换时机到 agent 侧)。
- `view/` 目录 —— 旧 Python 版的可视静态站目录。可视数据现走 HTTP(ADR-0001),不落盘。
- `pending/` —— 草稿区。实际未使用,已从代码与目录中移除。

## 关键工作流

- **Ingest** —— 上传源到 `raw/`(经界面上传,md/非 md 均原样落,不预转)→ agent 按 §1 编译规则处理(md/纯文本原样读,pandoc 格式经 pandoc 工具转文本)→ 更新 Compiled + Metadata → 触发 build
- **Query** —— 用户提问 → agent 读 Metadata 定位 → 读 Compiled/Source 合成回答 → 判断回写 → 更新 Metadata
- **Build** —— agent 回合结束后,server 调 `buildView` 纯函数扫 Compiled(除导航页 `00-知识库导航`)+ Reports → 内存缓存 → 经 HTTP 暴露给 layer2

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

z-wiki 的视觉外观有两套主题,各自有完整调色板(基底明暗反转,accent 不同源)。纯阅读偏好,不进 server 单一真相源,存 localStorage。

- **Archive(暗)** —— 深色工业档案风主题。温润深底 + 低饱和靛青 accent + 档案展台调性;靛青是其档案身份的一部分。
- **Draft(浅)** -- 档案室风浅色主题。略泛黄纸底 + 蓝黑墨水 accent(档案登记本钢笔墨水);陶土橙降级为书架色板偶发暖点缀(ADR-0006 材质正色传承)。accent 与 Archive 同源蓝系(蓝黑墨水↔靛青),切换时不跳变。
- **书架随主题** -- 首页 3D 书架的展台底色与书皮配色随主题切换(Archive 深舞台 + 靛青封面色板 / Draft 浅展台 + 案卷色板)。两套书皮纹理在主题切换时换 texture,不重建 3D 场景。
- **主题开关** —— header 设置按钮右侧的 pill 滑动开关(月左日右),无文字、纯图标,控制明暗切换。a11y 对齐项目自定义控件基准(`role="switch"`+键盘)。

## 书架槽位(layer2 可视层)

首页 3D 书架的圆柱槽位编址。仅领域语言,实现细节见 ADR-0015。

- **槽位(slot)** -- 3D 书架圆柱上书对象的均分位置,整数 slotIndex 编址、slot0 钉几何中心。slots 恒奇数保 slot0 居中(slot0 体系是 currentSlot/slotMap/reflow 的几何基石)。
- **有效数** -- 补虚拟凑奇后的槽位数。N≤9 -> 2N−1（满窗）；N≥10 -> N−1 奇数化（reflow）（ADR-0015 D1）。
- **虚拟位** -- N≤9 凑奇数 slots 时留的空占位槽（mod 重复位，负侧），不渲染书对象、不参与交互（ADR-0015 D2）。
- **真书槽集(realSlots)** -- 实际承载书对象的槽位(虚拟位除外),当前聚焦槽(currentSlot)只在其上量化、永不着陆虚拟位(ADR-0015 D3)。

_Avoid_: 把虚拟位叫"假书/占位书"(它不渲染成书);把 realSlots 叫"可见槽"(虚拟位也在可见窗口,只是空)。

## 桌面分发(app 更新)

z-wiki 桌面 app 的更新分发。仅领域语言,实现细节见 ADR-0018。

终端用户更新不走 electron-updater(其 Squirrel 替换 `.app` bundle 要签名,ADR-0003 不签名约束下 mac 无法自动更新),改用自建覆盖式更新:app 进程写自己的 `Resources/app/` 目录,不签名也能 mac 自动更新。三档包 + 三版本号,客户端从重到轻比对选包(linux AppImage 例外,走完整包替换)。

- **完整包(Full Bundle)** -- runtime + 工具二进制 + 第三方依赖 + 项目代码的完整安装包,按平台+arch 分(dmg/exe/AppImage)。新用户首装、`baselineVersion` 变时下。_Avoid_: 安装包, installer
- **应用包(App Bundle)** -- 整个 `app/` + `web/dist/` 的 tar.gz,跨平台(native prebuilds 全平台都打进 node_modules)。`depsVersion` 变时下,整体替换 `app/`(含 `node_modules`)。_Avoid_: 依赖包
- **代码包(Code Patch)** -- 仅项目代码(`app/dist` + `app/node_modules/@z-wiki/server` + `web/dist` + `app/package.json`)的 tar.gz,跨平台。常规更新(`appVersion` 变)下,覆盖这 4 处路径。_Avoid_: 增量包(模糊上位词,应用包也是增量)
- **baselineVersion** -- runtime + 工具二进制(Electron/pandoc/rg/fd)版本。变则下完整包重新安装(极少)。
- **depsVersion** -- 第三方依赖版本(`package-lock.json` 指纹)。变则下应用包整体替换 `app/`(偶尔)。
- **appVersion** -- 项目代码版本。变则下代码包覆盖 4 处(常规)。
- **覆盖式更新** -- app 进程写自己的 `Resources/app/` 目录完成更新,不走"替换整个 .app bundle"。绕过 Squirrel 签名约束,mac 不签名也能自动更新。linux AppImage 只读不能覆盖,例外走完整包替换。

_Avoid_: 把"应用包/代码包"统称"增量包"--两者都是相对完整包的增量,但触发条件(版本号)与覆盖动作不同,需区分。
