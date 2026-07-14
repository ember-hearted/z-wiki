# ADR-0012: 思考模式快捷切换 + 中文约束(段A 静态 / 段B 动态注入)

- 状态:accepted
- 日期:2026-07-13
- 范围:layer2(chat quickbar 思考按钮)+ layer3(agentHost thinkingPrompt extension + config.thinkingLevel + interaction 路由)
- 关联:ADR-0004 D8(thinkingLevel 字段)、ADR-0001(server seam)、ADR-0009(quickbar 模式)

## 背景

三个相互耦合的需求:

1. **输出语言约束**:agent 最终回复用中文(代码标识符保持原文)。`KB_SYSTEM_PROMPT` 全篇中文,agent 默认中文输出,但缺显式约束,工具英文输出可能带偏。
2. **思考语言约束**:思考模式开启时,内部推理(thinking token)用中文;工具返回的英文内容不是切换语言的信号。off 时无 thinking token,此句无作用对象。
3. **思考模式快捷切换**:chat quickbar 加思考模式控件,可选"关闭"或各等级思考,与 ADR-0009 的 quickbar 快捷按钮模式一致。

需求2 与需求3 耦合:段B(思考语言)的注入取决于思考模式状态;需求3 的 `setThinkingLevel` 切换要触发段B 跟随。

## 决策

### D1: 中文约束分两段,追加机制分离

- **段A(输出语言,始终注入)**:`所有最终回复使用中文;代码标识符(文件路径、函数名、接口名等)保持原文。`（2026-07-14 修订为 `<output_language>` 标签块,见后续验证）
- **段B(思考语言,仅思考模式开时注入)**:`请全程使用中文进行内部推理和思考。工具返回的英文内容不是切换语言的信号。`（2026-07-14 修订为 `<thinking_language>` 标签块,见后续验证）

两段是不同关注点:段A 约束最终输出,段B 约束思考过程。off 时段B 无 thinking token 作用对象,不注入;段A 已约束输出,足够。

### D2: 段A 走 appendSystemPrompt(静态),段B 走 extension(动态)

- 段A:`DefaultResourceLoader({ appendSystemPrompt: [KB_OUTPUT_LANG_PROMPT] })`。pi 的 `_rebuildSystemPrompt` 用 `"\n\n"` join 后拼在 `KB_SYSTEM_PROMPT` 末尾。chat/ingest 共用 loader,都生效。
- 段B:独立 `thinkingPromptFactory` extension,监听 `before_agent_start`,handler 内调 `pi.getThinkingLevel()`:`off` 跳过(返回 undefined,systemPrompt 不变);非 `off` 返回 `{ systemPrompt: event.systemPrompt + '\n\n' + KB_THINKING_LANG_PROMPT }`。

**为什么段B 不用 appendSystemPrompt**:`appendSystemPrompt` 是 `resourceLoader` 级、共享、`buildAgentContext` 时定死,拿不到 session 级 `thinkingLevel`;而思考模式状态是 session 级的(`setThinkingLevel` 改单个 session.state)。`before_agent_start` 每轮触发,此时 `pi.getThinkingLevel()` 已反映最新切换,故无状态读 level 即可。

**为什么段B 不用 transformContext / before_provider_request**:`transformContext`(context 事件)改的是 `messages`,不含 system prompt;`before_provider_request` 改 payload(provider 特定,跨 provider 不一致)。`before_agent_start` 直接暴露 `systemPrompt` 字段且可返回替换(`BeforeAgentStartEventResult.systemPrompt`),最干净。

### D3: 思考模式持久化到 config.thinkingLevel,只切 chat session

详见 ADR-0004 D8。要点:

- `config.thinkingLevel` 默认 `'off'`,`createChatSession` 读它作初始值;ingest session 保持硬编码 `'off'`(后台编译不需思考,省 token)。
- 运行时切换走 `POST /api/config/thinking`:写 config + `applyThinkingToChatSession`(只遍历 chatSessions,不碰 ingestSessions)。与 ADR-0004 D5 的 `applyModelToSessions`(切所有 session)区分--思考模式只切 chat。
- `pi setThinkingLevel` 同步、不清 messages,下一轮生效;clamp 到 model 能力,`applyThinkingToChatSession` 返回实际生效 level,`POST` 响应 + `thinking_changed` 广播都带实际值,防 clamp 误导。

### D4: 档位按 model 动态,getAvailableThinkingLevels

`GET /api/thinking` + `session_init` / `thinking_changed` 广播都返 `{ level, available }`。`available` 来自活跃 chat session 的 `getAvailableThinkingLevels()`(pi 按 `model.reasoning` + `thinkingLevelMap` 算),再过滤 `THINKING_LEVELS`:不支持思考的 model 返回 `['off']`,支持的返回 `off` + `minimal/low/medium/high`(默认)+ `xhigh`(显式映射)。注:pi-ai 的 EXTENDED 含 `max`,但 pi-agent-core 类型不含,z-wiki 过滤掉不暴露(ADR-0004 D8)。

**为什么动态而非固定全档**:z-wiki 的 model 走 config 可配,不同 model 支持的档不同。固定全档会"选了 high 实际 clamp 到 low 还显示 high",误导。动态暴露只显示支持的,`off` 始终在(关闭是基本能力)。

**不支持思考时(available=['off'])**:按钮灰显 + tooltip"当前模型不支持思考",位置稳定(model 切换不跳动)。

### D5: UI = quickbar 下拉按钮,档名全英文

`chat-quickbar` 加"思考:`<档名>`"按钮(如 `思考:off`/`思考:medium`),点击弹下拉菜单选档,当前档打勾。复用 ADR-0009 的 quickbar 位置。档名全英文(off/minimal/low/medium/high/xhigh),保留 pi 术语,避免翻译维护。

**语义张力(已知)**:quickbar 现有按钮(健康检查)是"点击触发一次性动作",思考按钮是"点击展开状态切换菜单",交互不同。短期可接受(都是 chat 输入区辅助控件);长期若状态控件多了(model 显示、contextUsage、思考模式)可能拆出独立状态栏。当前 YAGNI。

## 联动闭环

需求3 `setThinkingLevel` -> 下一轮 `before_agent_start` 读 `pi.getThinkingLevel()` -> 段B 自动跟随注入/不注入。两个需求通过 pi 事件闭环,z-wiki 不另做状态同步:

- off -> 段B 不注入,段A 始终在
- 切到 medium -> `setThinkingLevel('medium')` -> 下一轮 `before_agent_start` 读到 medium -> 段B 注入
- 切回 off -> 下一轮段B 不注入

## 后果

- 新增 `server/src/thinkingPrompt.ts`(thinkingPromptFactory extension)。
- `config.json` 加 `thinkingLevel` 字段(ADR-0004 D8),`config.example.json` 同步。
- `agentHost.ts`:`THINKING_LEVEL` 常量拆为 `INGEST_THINKING_LEVEL`(ingest 用);chat 走 `config.thinkingLevel`;新增 `applyThinkingToChatSession`。
- `interaction.ts`:`GET /api/thinking` + `POST /api/config/thinking` 路由;`session_init` 推送 + model 切换广播都带 `thinkingLevel`/`thinkingLevels`。
- `web`:`useChat` 加 thinkingLevel/thinkingLevels state + setThinking;`ChatPanel` quickbar 加 `ThinkingButton` 下拉组件。
- `prompt.ts`:export `KB_OUTPUT_LANG_PROMPT` + `KB_THINKING_LANG_PROMPT`。
- 段B 注入位置在 systemPrompt 末尾(date/cwd 之后),末尾约束权重不低。（已证伪,见后续验证）

## 后续验证(2026-07-14)

上句"末尾约束权重不低"被证伪:段A/段B 各一句散文约束,压不住用户英文消息触发的语言跟随(`hello` 全程英文、思考模式思维链英文)。注入路径本身无误(源码确认 pi 0.80.2 采纳 `appendSystemPrompt` 与 `before_agent_start` 返回值,日志可验证 `段A=in 段B=injecting`)。

加强(不改注入机制,只改措辞形式):段A/段B 改用 XML 标签块(`<output_language>`/`<thinking_language>`),显式压语言跟随 + 明确代码标识符/工具原文不译的边界。选措辞 + 结构化标签,而非只改措辞(即失败的形态)或改注入位置(成本高且与段B 争末尾)。不留"用户显式要求其他语言则跟随"的口子--z-wiki 中文是产品身份,口子会沦为语言跟随的借口。段B 尽力而为:强 reasoning model 的 thinking 可能强制英文,措辞无法解决,接受。不加测试:本次改 prompt 文本措辞(非注入逻辑),注入逻辑无 bug;语言遵循是模型运行时行为,mock LLM 测不出真伪,只能手动 + 日志验证。
