# ADR-0004: LLM 配置 —— 干掉 provider 预设,baseUrl/api/model 用户可配 + 运行时热重载不丢上下文

- 状态:partially superseded(D8 的「config.reasoning 字段 + available 档位暴露」由 ADR-0021 取代,D8 thinkingLevel 持久化及其余决策 accepted)
- 日期:2026-07-03
- 范围:z-wiki 的 LLM 配置从"首版固定 ark"演进到"用户可配任意 OpenAI/Anthropic 兼容端点",涉及 config.json schema、api 规范 manifest、baseUrl 规范化、配置生效机制
- 关联:ADR-0003 D3.1(config.json 单一真相源)、ADR-0001(server seam)

## 背景

ADR-0003 D3.1 把 `config.json` 定为单一真相源,但 LLM 配置当时固定为 ark provider(`generateModelsJson` 硬编码 `ARK_BASE_URL`/`ARK_API`,`provider !== 'ark'` 直接抛错)。用户需要对接自有的 OpenAI/Anthropic 兼容端点(如自建网关、第三方代理、其他云厂商),无法通过 UI 配置。

两个具体痛点:

1. **baseUrl 自动拼接**:pi 底层用官方 SDK——`openai-completions` 走 `new OpenAI({ baseURL })` + POST `/chat/completions`;`anthropic-messages` 走 `new Anthropic({ baseURL })` + POST `/v1/messages`。SDK 只做尾斜杠去重,**不剥后缀**。用户若把完整 URL(含 `/chat/completions` 或 `/v1/messages`)粘进 baseUrl,会双拼成 `.../chat/completions/chat/completions` → 404。
2. **配置改了不生效**:`modelRegistry` 在 `buildAgentContext` 时一次性构建,改 baseUrl/api/model 后不重启 server 则 agent 仍走老配置。`setRuntimeApiKey` 只热更新 apiKey,不重建 registry。

## 决策

### D1: 干掉 provider 概念,config 存 baseUrl/api/model

`ConfigJson` 去掉 `provider` 字段,改为直接存 `baseUrl`/`api`/`model`/`apiKey` + `exposedApiSpecs`(UI 暴露的 api 规范子集)。ark 不再特殊——它只是"baseUrl + anthropic-messages + model=ark-code-latest"的一组值,用户照填即可。

不保留 provider 做"预设回退"(provider='ark' 时若 baseUrl/api 为空回退硬编码默认值)——两套真相容易漂移,且 Q3.1 明确不需要预设 UI。config 的真相就是 baseUrl/api/model 本身。

### D2: apiSpecs manifest(代码文件),首版只暴露两个规范

新建 `server/src/apiSpecs.ts`,导出 typed manifest `API_SPECS: readonly ApiSpecEntry[]`。每项含 `id`(对齐 pi 的 `KnownApi`)/`label`(UI 显示名)/`suffix`(SDK 自动追加的 path,用于 D3 规范化)。`config.exposedApiSpecs` 控制实际暴露的子集,默认 `['openai-completions','anthropic-messages']`。

**首版只暴露这两个**——它们覆盖 99% 的"自定义 OpenAI/Anthropic 兼容端点"场景(含 ark),且只需 baseUrl+apiKey+model 三个字段。

bedrock-converse-stream / google-vertex / google-generative-ai 等规范**不暴露**。原因:它们的额外字段(region/projectId/awsAccessKeyId 等)无法从 models.json 喂入 pi——pi 的 `ProviderConfigSchema` 只有 `{ baseUrl, apiKey, api, headers, compat, authHeader, models, modelOverrides }`,没有 region/aws 字段;这类规范走 env var / OAuth / ambient credentials。在 UI 上"选 bedrock → 带出 region 输入框 → 存 config → 喂给 pi"链路走不通。想用的人编辑 `config.json` 的 `exposedApiSpecs` + 配 env var,绕过 UI。UI 上用 `ⓘ` 图标 + hover tooltip 指引。

manifest 放代码文件而非 JSON:`id` 跟 pi `KnownApi` 强绑,类型安全;加规范要发版,但这类需求极低频。

### D3: baseUrl 规范化 —— 写入时剥尾部已知 suffix + trailing slash

`writeConfig` 写入前调 `normalizeBaseUrl(baseUrl, api)`:

- 只剥 api 对应的 suffix(openai-completions 剥 `/chat/completions`,anthropic-messages 剥 `/v1/messages`)。
- trailing slash 也剥。
- 后缀跟 api 不匹配(如选 anthropic 但 URL 尾部是 `/chat/completions`)→ **不剥,原样存**(不警告)。
- 未知 api(不在 `API_SPECS`)→ 不处理。
- **不智能推断中间路径**(如 `/v1`)。

"不智能推断"的理由:ark 用 `https://ark.cn-beijing.volces.com/api/coding` + `anthropic-messages`,SDK 拼出 `.../api/coding/v1/messages`——这里 `/v1` 是 anthropic SDK 追加的,ark 的 baseUrl 里没有 `/v1`。若规范化"智能剥 `/v1/messages`",对 ark 这种非标准 host 会误伤。保守策略"只剥用户多粘的尾部 suffix"安全且可预测。

规范化放 `writeConfig`(真相源写入层),不放 UI 也不放 `generateModelsJson`:真相源存干净值,UI 回显自然一致,`generateModelsJson` 无需感知规范化。

### D4: provider key 固定 'custom'

干掉 provider 概念后,models.json 的 provider key、`setRuntimeApiKey` 的 provider 参数、`resolveModel` 的 `find(provider, modelId)` 三者需要一致。固定常量 `PROVIDER_KEY = 'custom'`:

- `models.json = { providers: { custom: { baseUrl, api, models } } }`
- `authStorage.setRuntimeApiKey('custom', apiKey)`
- `modelRegistry.find('custom', modelId)`

三处用同一常量,避免拼错导致 model 解析失败。这是内部实现细节,用户不感知。

### D5: 配置生效走 modelRegistry.refresh() + session.setModel(),不丢上下文

改 LLM 配置后(切片 2 落地的 `POST /api/config/llm`),不 close WS、不重建 AgentContext、不丢对话:

1. `readConfig` → 读新配置。
2. `writeModelsJson` → 重生成 models.json 到磁盘。
3. `agentCtx.modelRegistry.refresh()` → 重读 models.json(**同一对象**,所有 session 引用不变,内部 model 列表更新)。
4. `agentCtx.authStorage.setRuntimeApiKey(PROVIDER_KEY, apiKey)` → 更新 auth。
5. `resolveModel(agentCtx)` → 拿新 model 对象。
6. 遍历所有活跃 session(chat + ingest)→ `await session.setModel(newModel)`。
7. broadcast `config_reloaded` → 前端不清空消息,只 toast。

关键依据:pi 的 `AgentSession.setModel(model)`(pi-coding-agent agent-session.js)只换 `agent.state.model` 引用 + 记 modelChange + 重新 clamp thinkingLevel,**不清 messages**。对话历史完整保留,下一轮 prompt 用新 model + 老上下文。

ingest session 也 setModel(Q4.1c):用户可能因额度问题换配置,正在跑的 ingest 应切到新 model,不能继续扣旧 provider 的钱。

### D6: 空壳能起 —— baseUrl/model/apiKey 空时 readConfig 不抛

`readConfig` 只在文件不存在 / 解析失败时抛错。`apiKey`/`baseUrl`/`model` 空 → 不抛(空壳能起,server 能启动)。`api` 缺失/空 → 回退 `'openai-completions'` + warn。`exposedApiSpecs` 缺失/空 → 回退 `DEFAULT_EXPOSED_SPECS`。

调用 agent 时才报错:`resolveModel` 找不到 model(`find('custom','')` 返回 undefined)→ 抛"模型未找到"。与 ADR-0003 D4"空 apiKey 壳能起"一致——首次启动配置不全不是 fatal,填完配置重载即可。

### D7: 老 PUT /api/config/apikey 废弃,新增 POST /api/config/llm(切片 2 落地)

老接口只写 apiKey(热更新),无法处理 baseUrl/api/model。新接口 `POST /api/config/llm` 接收 `{ baseUrl, api, model, apiKey }` 全量,走 D5 的冷重载流程。老 `PUT /api/config/apikey` 删除。设置页是唯一调用方,无外部依赖。

空 apiKey 时 UI 提前拦(按钮禁用)+ 后端校验返回 400(避免 setModel 抛 `No API key` 错误)。

### D8: thinkingLevel 字段 -- 思考模式持久化(详见 ADR-0012)

`ConfigJson` 加 `thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`(默认 `'off'`,与 pi-agent-core ThinkingLevel 对齐;不含 `'max'`--pi-agent-core 类型不支持,serializeThinking 过滤掉)。与 baseUrl/api/model 同为 config.json 真相源字段,但语义是"思考模式偏好"而非 LLM 端点配置。

- 仅作用于 chat session:`createChatSession` 读它作初始 `thinkingLevel`;ingest session 保持硬编码 `'off'`(后台编译不需思考,省 token)。
- 运行时切换走 `POST /api/config/thinking`:写 config + 当前 chat session `setThinkingLevel`(只切 chat,不切 ingest,与 D5 的 `applyModelToSessions` 切所有 session 不同)。
- 档位按 model 能力动态:`getAvailableThinkingLevels()` 返回当前 model 支持的档(含 off;不支持思考的 model 只有 `['off']`)。
- `reasoning` 字段(model 是否支持思考):`config.reasoning` 显式覆盖,否则 `generateModelsJson` 按 baseUrl 自动推断(DeepSeek -> true)。写入 models.json 的 `model.reasoning`,pi-ai 据此判断是否传 thinking 参数(openai-completions 的 deepseek 分支要求 `model.reasoning` 才传 `thinking`+`reasoning_effort`)。设置页 LLM 配置区暴露勾选框(默认显示自动推断值)。
- `thinkingLevelMap`(pi 档位 -> provider effort 映射):DeepSeek 自动注入 `{minimal/low/medium/high:'high', xhigh:'max'}`(DeepSeek effort 只认 high/max);其他 reasoning model 不注入,走 pi 默认(传 pi 档名,provider 自行映射)。不进 config/设置页(provider 特定知识,用户不该填)。
- 配套的中文思考约束(段B)由 `thinkingPromptFactory` extension 在思考模式开启时动态注入 system prompt,详见 ADR-0012。

## 后果

- **config.json schema 破坏性变更**:老 config(有 `provider`/无 `baseUrl`)在开发阶段直接重填,不做迁移。`readConfig` 不识别 `provider` 字段(忽略),老 config 的 `provider:'ark'` 信息丢失——用户需从 `config.example.json` 重复制并填入 ark 的 baseUrl/api/model。
- **`generateModelsJson` 签名变更**:`Pick<ConfigJson,'provider'|'model'>` → `Pick<ConfigJson,'baseUrl'|'api'|'model'>`。`agentHost.ts`/`config.test.ts` 已同步。
- **bedrock/google 用户绕过 UI**:这类规范无法从设置页配置,需手编 config.json + env var。可接受(需求极低频)。
- **ingest 中途换 model**:D5 让 ingest session 也 setModel,可能导致同一次 ingest 的输出前后半段风格不一致(前半老 model 写,后半新 model 写)。可接受——用户主动重载,且避免老 provider 继续扣费优先级更高。
