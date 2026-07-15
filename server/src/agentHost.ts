import path from 'node:path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  defineTool,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { Api, Model, TextContent } from '@earendil-works/pi-ai'
import { KB_SYSTEM_PROMPT, KB_OUTPUT_LANG_PROMPT, KB_MD_RULES } from './prompt.js'
import { thinkingPromptFactory } from './thinkingPrompt.js'
import { runHealthCheck, type HealthReport } from './healthCheck.js'
import { kbHooksFactory } from './kbHooks.js'
import {
  PROVIDER_KEY,
  readConfig,
  writeConfig,
  writeModelsJson,
  writeShellSettingsJson,
  type ConfigJson,
  type ThinkingLevel,
} from './config.js'

// ingest agent 固定 off(后台编译不需思考,省 token);chat agent 走 config.thinkingLevel(ADR-0004 D8)。
const INGEST_THINKING_LEVEL = 'off' as const

// agent 默认工具集:知识库编译器所需能力 + pandoc(非 md 转换,customTool,ADR-0011)。
const AGENT_TOOLS = ['read', 'edit', 'write', 'grep', 'find', 'ls', 'pandoc'] as const

/**
 * 构造 pandoc 工具(ADR-0011):customTool 直接 spawn pandoc 二进制,argv 不经 shell,
 * 无元字符注入面(取代 ADR-0007 决策 2 的 bash+白名单)。复用 ADR-0007 决策 3 的内置 pandoc。
 * to 固定 markdown(知识库只用 md);from 可选(省略则 pandoc 按后缀推断)。
 * stdout 截断 256KB + 超时 30s,防大文件撑爆上下文或卡死。
 */
function makePandocTool(kbRoot: string, agentDir: string) {
  const pandocBin = path.join(
    agentDir,
    'bin',
    process.platform === 'win32' ? 'pandoc.exe' : 'pandoc',
  )
  const MAX_STDOUT = 256 * 1024
  const PANDOC_TIMEOUT_MS = 30_000
  return defineTool({
    name: 'pandoc',
    label: '文档转换',
    description:
      '用 pandoc 把非 md 文件(docx/xlsx/pptx/odt/epub/html/rtf/csv/json 等)转为 markdown 文本。参数:filePath(必填,相对 cwd 的文件路径)、from(可选,输入格式,省略则按后缀推断)。输出固定 markdown。读非 md 文件用此工具,不要用 read(会拿二进制乱码)。',
    parameters: Type.Object({
      filePath: Type.String({ description: '要转换的文件路径(相对 cwd)' }),
      from: Type.Optional(Type.String({ description: '输入格式(如 docx),省略则按后缀推断' })),
    }),
    async execute(_toolCallId, params) {
      const args = params.from
        ? ['--from', params.from, params.filePath, '-t', 'markdown']
        : [params.filePath, '-t', 'markdown']
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(pandocBin, args, { cwd: kbRoot })
        let buf = ''
        let stderr = ''
        let done = false
        const finish = (out: string) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(out)
        }
        const timer = setTimeout(() => {
          child.kill()
          finish(`${buf}\n…(pandoc 超时 30s)`)
        }, PANDOC_TIMEOUT_MS)
        child.stdout.setEncoding('utf-8')
        child.stderr.setEncoding('utf-8')
        child.stdout.on('data', (d: string) => {
          buf += d
          if (buf.length >= MAX_STDOUT) {
            child.kill()
            finish(`${buf.slice(0, MAX_STDOUT)}\n…(已截断 ${MAX_STDOUT} 字节)`)
          }
        })
        child.stderr.on('data', (d: string) => {
          stderr += d
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
        child.on('close', (code) => {
          if (code !== 0 && !buf) {
            clearTimeout(timer)
            reject(new Error(`pandoc 退出码 ${code}: ${stderr}`))
          } else {
            finish(buf)
          }
        })
      })
      const content: TextContent[] = [{ type: 'text', text }]
      return { content, details: undefined }
    },
  })
}

/**
 * 构造健康检查工具(ADR-0009):只读扫 kb/ 返回结构化 HealthReport。
 * 纯 TS 实现(不调外部二进制,无注入面);用 kbRoot 参数不依赖 agent cwd。
 * description 软约束:仅健康检查,归档走 /skill:health-check(Q4 ii)。
 */
function makeHealthCheckTool(kbRoot: string) {
  return defineTool({
    name: 'health_check',
    label: '健康检查',
    description:
      '扫描知识库健康(断链/孤儿/空文件/重复文件名/frontmatter 覆盖率),返回结构化结果。仅用于知识库健康检查;归档到 log.md 走 /skill:health-check。',
    parameters: Type.Object({}),
    async execute() {
      const report: HealthReport = await runHealthCheck(kbRoot)
      const content: TextContent[] = [{ type: 'text', text: JSON.stringify(report, null, 2) }]
      return { content, details: report }
    },
  })
}

export interface AgentContextOptions {
  /**
   * 当前 Vault 的 kb/ 根目录(agent cwd,随 Vault 切换)。
   * 仅用于 buildAgentContext 的初始 existsSync 校验;切库后不靠 AgentContext 携带(D7),
   * 改由 createChatSession/createIngestSession 的显式 kbRoot 参数传入。
   */
  kbRoot: string
  /** 全局 agent 目录(`<appRoot>/.pi/agent/`,pi 约定),含 models.json/sessions/bin。 */
  agentDir: string
}

export interface AgentContext {
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  resourceLoader: DefaultResourceLoader
  /** 全局 agent 目录(.pi/agent/)。 */
  agentDir: string
  /**
   * app 根(resourceLoader cwd + chat sessionManager 基准 + config.json 所在),全局、不随 Vault 切换(D7)。
   * = agentDir 上两级(`<x>/.pi/agent` → `<x>`),与 pi `getAgentDir()` 约定一致。
   */
  appRoot: string
  /** 引导配置(全局真相源,ADR-0003 D3.1)。provider/model 供 resolveModel 用,apiKey 已注入 authStorage。 */
  config: ConfigJson
}

/**
 * 构建 agent 共享上下文:auth + model registry + resource loader(系统提示词 + kb 钩子)。
 * 对话 agent 与后台 ingest agent 共用同一份。路径全部由参数传入,不依赖模块级常量。
 */
export async function buildAgentContext(opts: AgentContextOptions): Promise<AgentContext> {
  const { kbRoot, agentDir } = opts
  // appRoot = agentDir 上两级(.pi/agent → .pi → appRoot)。config.json 落在此(ADR-0003 D3)。
  const appRoot = path.dirname(path.dirname(agentDir))

  // layer1 内容必须在 kb/(ADR-0002)。缺失则提示从样板起步,失败快。
  if (!existsSync(kbRoot)) {
    throw new Error(`知识库目录不存在:${kbRoot}\n请先复制样板起步:cp -r kb_example kb`)
  }

  // 引导配置(单一真相源):读 config.json,生成 models.json(派生产物)喂 ModelRegistry。
  const config = readConfig(path.join(appRoot, 'config.json'))
  // apiKey 空是桌面首次启动的正常态(ADR-0003 D4);warn 提示开发者,agent 调用会在 WS prompt 失败。
  if (!config.apiKey) {
    console.warn('[z-wiki] config.json 的 apiKey 为空,agent 调用将失败(切片 05 设置页填 key)。')
  }
  const modelsJsonPath = writeModelsJson(agentDir, config)
  // 派生 pi 的 settings.json 的 shellPath 字段(ADR-0003 D6 覆盖口子)。与 models.json 同为启动派生产物,
  // 但 settings.json 由 pi 管理,writeShellSettingsJson 用 read-modify-write 只注入 shellPath。运行时不写,
  // 改 shellPath 走 POST /api/config/shell 写 config.json + 重启生效。
  writeShellSettingsJson(agentDir, config)

  // authStorage 用内存后端 + setRuntimeApiKey:apiKey 运行时注入,auth.json 不落盘(ADR-0003 D3.1)。
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(PROVIDER_KEY, config.apiKey)
  const modelRegistry = ModelRegistry.create(authStorage, modelsJsonPath)

  // 资源加载器:注入知识库系统提示词 + 段A(输出语言)+ 段C(md 规则),始终追加;+ kb 钩子 + 思考语言 extension。
  // 段B(思考语言)不走 appendSystemPrompt--它是 session 级动态(thinkingPromptFactory 按 thinkingLevel 注入)。
  const resourceLoader = new DefaultResourceLoader({
    cwd: appRoot,
    agentDir,
    systemPromptOverride: () => KB_SYSTEM_PROMPT,
    appendSystemPrompt: [KB_OUTPUT_LANG_PROMPT, ...KB_MD_RULES],
    extensionFactories: [kbHooksFactory, thinkingPromptFactory],
  })
  await resourceLoader.reload()

  return { authStorage, modelRegistry, resourceLoader, agentDir, appRoot, config }
}

/** 查找配置好的模型,找不到则抛错。 */
export function resolveModel(ctx: AgentContext) {
  const { model: modelId } = ctx.config
  const model = ctx.modelRegistry.find(PROVIDER_KEY, modelId)
  if (!model) {
    throw new Error(`模型未找到:id="${modelId}"。请检查 config.json 的 baseUrl/api/model 字段。`)
  }
  return model
}

/**
 * 冷重载 LLM 配置(ADR-0004 D5):重写 models.json → modelRegistry.refresh() →
 * setRuntimeApiKey → resolveModel,返回新 model 供调用方遍历 session.setModel。
 *
 * 不重建 AgentContext(同一 modelRegistry 对象,session 引用不变)。调用方在 withFileLock
 * 内 read-modify-write + writeConfig 后,把规范化的 config 传入(writeConfig 已规范化 baseUrl,
 * generateModelsJson 再规范一次是幂等)。refresh 重读 models.json(同一对象内部更新),
 * 后续 setModel 不清 messages → 对话上下文保留。
 */
export async function reloadAgentConfig(
  ctx: AgentContext,
  config: ConfigJson,
): Promise<Model<Api>> {
  writeModelsJson(ctx.agentDir, config)
  ctx.modelRegistry.refresh()
  ctx.authStorage.setRuntimeApiKey(PROVIDER_KEY, config.apiKey)
  ctx.config = config
  return resolveModel(ctx)
}

/**
 * 遍历所有活跃 session(chat + ingest),换到新 model(ADR-0004 D5)。
 * pi 的 setModel 只换 model 引用 + 记 modelChange,不清 messages →
 * 对话上下文保留,下一轮用新 model + 老上下文。
 * 调用方保证 model 的 auth 已配置(reloadAgentConfig 内 setRuntimeApiKey 过),
 * 否则 setModel 抛 "No API key"。
 *
 * 用 allSettled 而非 Promise.all:一个 session 失败不中断其他 session 换 model,
 * 失败汇总后抛错让调用方感知(避免部分换部分没换的静默分裂)。
 */
export async function applyModelToSessions(
  sessions: Iterable<AgentSession>,
  model: Model<Api>,
): Promise<void> {
  const results = await Promise.allSettled(Array.from(sessions).map((s) => s.setModel(model)))
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    const reasons = failures.map((f) => String(f.reason)).join('; ')
    throw new Error(`部分 session 换 model 失败:${reasons}`)
  }
}

/**
 * 切换当前 chat session 的思考模式(ADR-0004 D8 / ADR-0012)。
 * 与 applyModelToSessions 的区别:只切 chat session,不切 ingest(后台编译保持 off,省 token)。
 * pi setThinkingLevel 同步、不清 messages,下一轮生效;clamp 到 model 能力,返回实际生效 level。
 * 调用方负责先写 config.thinkingLevel(真相源);此处只改 session 运行时状态。
 */
export function applyThinkingToChatSession(
  sessions: Iterable<AgentSession>,
  level: ThinkingLevel,
): ThinkingLevel {
  let actual = level
  for (const s of sessions) {
    s.setThinkingLevel(level)
    // pi clamp 后实际 level 可能与请求不同;取最后一个 session 的实际值(多 session 理论上一致)。
    actual = s.thinkingLevel
    if (actual !== level) {
      console.warn(`[z-wiki] thinkingLevel ${level} 被 clamp 到 ${actual}(model 能力限制)`)
    }
  }
  return actual
}

export interface CreateChatSessionOptions {
  ctx: AgentContext
  /** 当前 Vault 的 kb/ 根(agent cwd,随 Vault 切换;D7 显式参数,不从 ctx 取)。 */
  kbRoot: string
  onEvent: (event: AgentSessionEvent) => void
}

/**
 * 创建对话 agent 会话(per-WS-connection,断开即 dispose)。
 * 前端消息经 WS 进来 → session.prompt() → onEvent 推回前端。
 */
export async function createChatSession(opts: CreateChatSessionOptions): Promise<AgentSession> {
  const model = resolveModel(opts.ctx)
  const { agentDir, appRoot } = opts.ctx
  const { kbRoot } = opts
  const { session } = await createAgentSession({
    cwd: kbRoot,
    agentDir,
    model,
    // chat 走 config.thinkingLevel(ADR-0004 D8):持久化在 config.json,运行时切换走 POST /api/config/thinking。
    thinkingLevel: opts.ctx.config.thinkingLevel ?? 'off',
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    // 落盘到 .pi/agent/sessions/chat/——每次连接新建会话文件,不续上下文,历史留档
    sessionManager: SessionManager.create(appRoot, path.join(agentDir, 'sessions', 'chat')),
    // health_check 走 customTools,须同时在 tools 白名单里 pi 才启用,否则被 allowedToolNames 过滤(agent-session isAllowedTool)
    tools: [...AGENT_TOOLS, 'health_check'],
    customTools: [makePandocTool(kbRoot, agentDir), makeHealthCheckTool(kbRoot)],
  })
  session.subscribe(opts.onEvent)
  return session
}

export interface CreateIngestSessionOptions {
  ctx: AgentContext
  /** 当前 Vault 的 kb/ 根(agent cwd,随 Vault 切换;D7 显式参数,不从 ctx 取)。 */
  kbRoot: string
  onEvent: (event: AgentSessionEvent) => void
}

/**
 * 创建后台 ingest agent 会话(每次上传新建,持久化到独立 jsonl 便于追溯)。
 * 共享对话 agent 的 loader/modelRegistry/auth,但会话独立。
 * 上传 .md → 归档 raw → session.prompt(Ingest 指令) → agent_end 推结果。
 */
export async function createIngestSession(opts: CreateIngestSessionOptions): Promise<AgentSession> {
  const model = resolveModel(opts.ctx)
  const { agentDir } = opts.ctx
  const { kbRoot } = opts
  const { session } = await createAgentSession({
    cwd: kbRoot,
    agentDir,
    model,
    // ingest 固定 off:后台编译不需思考,省 token;不跟 config.thinkingLevel(ADR-0004 D8)。
    thinkingLevel: INGEST_THINKING_LEVEL,
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    // 持久化到 .pi/sessions/,文件名带时间戳避免覆盖
    sessionManager: SessionManager.create(path.join(agentDir, 'sessions')),
    tools: [...AGENT_TOOLS],
    customTools: [makePandocTool(kbRoot, agentDir)],
  })
  session.subscribe(opts.onEvent)
  return session
}

// ── 文件写锁:避免对话 agent 与后台 ingest agent 同时写同一文件 ──
const writeLocks = new Map<string, Promise<unknown>>()

/** 对给定文件路径串行执行 async 任务(按文件排队)。 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(filePath) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  writeLocks.set(
    filePath,
    prev.then(() => next),
  )
  await prev
  try {
    return await fn()
  } finally {
    release()
    // 清理:若当前锁已是队尾,移除避免 Map 无限增长
    if (writeLocks.get(filePath) === next) {
      writeLocks.delete(filePath)
    }
  }
}

/**
 * 原子读改写 config.json:withFileLock 串行化 + readConfig -> mutator -> writeConfig -> readConfig 回读。
 *
 * mutator 收到当前 disk config,返回**新** config(不可变,不 mutate 入参);writeConfig 写入并规范化 baseUrl。
 * 返回 readback 后的 config(已规范化),供冷重载喂给 reloadAgentConfig(同 POST /api/config/llm 原先的
 * `return readConfig(configPath)` 语义)。串行化保证:同 configPath 并发调用排队执行(切库写 currentVault
 * 与设置页写 llm/shell/thinking 可能并发,ADR-0003 D7 闭环)。
 */
export async function updateConfig(
  configPath: string,
  mutator: (cfg: ConfigJson) => ConfigJson,
): Promise<ConfigJson> {
  return withFileLock(configPath, async () => {
    const next = mutator(readConfig(configPath))
    writeConfig(configPath, next)
    return readConfig(configPath)
  })
}
