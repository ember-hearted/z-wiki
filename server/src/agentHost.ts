import path from 'node:path'
import { existsSync } from 'node:fs'
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { KB_SYSTEM_PROMPT } from './prompt.js'
import { kbHooksFactory } from './kbHooks.js'
import {
  PROVIDER_KEY,
  readConfig,
  writeModelsJson,
  writeShellSettingsJson,
  type ConfigJson,
} from './config.js'

// thinking 级别(可配置项暴露于此)。provider/model 改走 config.json(ADR-0003 D3.1)。
const THINKING_LEVEL = 'off' as const

// agent 默认工具集:知识库编译器所需能力,不含 bash(ADR-0003 D6 收紧能力面 + 跨平台一致)。
const AGENT_TOOLS = ['read', 'edit', 'write', 'grep', 'find', 'ls'] as const

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

  // 资源加载器:注入知识库系统提示词 + kb 钩子 extension
  const resourceLoader = new DefaultResourceLoader({
    cwd: appRoot,
    agentDir,
    systemPromptOverride: () => KB_SYSTEM_PROMPT,
    extensionFactories: [kbHooksFactory],
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
    thinkingLevel: THINKING_LEVEL,
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    // 落盘到 .pi/agent/sessions/chat/——每次连接新建会话文件,不续上下文,历史留档
    sessionManager: SessionManager.create(appRoot, path.join(agentDir, 'sessions', 'chat')),
    tools: [...AGENT_TOOLS],
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
    thinkingLevel: THINKING_LEVEL,
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    // 持久化到 .pi/sessions/,文件名带时间戳避免覆盖
    sessionManager: SessionManager.create(path.join(agentDir, 'sessions')),
    tools: [...AGENT_TOOLS],
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
