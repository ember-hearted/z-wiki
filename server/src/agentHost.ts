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
import { KB_SYSTEM_PROMPT } from './prompt.js'
import { kbHooksFactory } from './kbHooks.js'

// LLM 配置(可配置项暴露于此,改 provider/model 在此调整)
const PROVIDER = 'ark'
const MODEL_ID = 'ark-code-latest'
const THINKING_LEVEL = 'off' as const

// agent 默认工具集:知识库编译器所需能力,不含 bash(ADR-0003 D6 收紧能力面 + 跨平台一致)。
const AGENT_TOOLS = ['read', 'edit', 'write', 'grep', 'find', 'ls'] as const

export interface AgentContextOptions {
  /** 当前 Vault 的 kb/ 根目录(agent cwd,随 Vault 切换)。 */
  kbRoot: string
  /** 全局 agent 目录(`<appRoot>/.pi/agent/`,pi 约定),含 models.json/sessions/bin。 */
  agentDir: string
}

export interface AgentContext {
  authStorage: AuthStorage
  modelRegistry: ModelRegistry
  resourceLoader: DefaultResourceLoader
  /** 当前 Vault 的 kb/ 根(agent cwd,随 Vault 切换)。 */
  kbRoot: string
  /** 全局 agent 目录(.pi/agent/)。 */
  agentDir: string
  /**
   * app 根(resourceLoader cwd + chat sessionManager 基准),全局、不随 Vault 切换(D7)。
   * = agentDir 上两级(`<x>/.pi/agent` → `<x>`),与 pi `getAgentDir()` 约定一致。
   */
  appRoot: string
}

/**
 * 构建 agent 共享上下文:auth + model registry + resource loader(系统提示词 + kb 钩子)。
 * 对话 agent 与后台 ingest agent 共用同一份。路径全部由参数传入,不依赖模块级常量。
 */
export async function buildAgentContext(opts: AgentContextOptions): Promise<AgentContext> {
  const { kbRoot, agentDir } = opts
  // appRoot = agentDir 上两级(.pi/agent → .pi → appRoot)。
  const appRoot = path.dirname(path.dirname(agentDir))
  const modelsJson = path.join(agentDir, 'models.json')

  // layer1 内容必须在 kb/(ADR-0002)。缺失则提示从样板起步,失败快。
  if (!existsSync(kbRoot)) {
    throw new Error(`知识库目录不存在:${kbRoot}\n请先复制样板起步:cp -r kb_example kb`)
  }

  const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'))
  const modelRegistry = ModelRegistry.create(authStorage, modelsJson)

  // 运行时注入 API key(不落盘)。优先用 .env 的 ARK_API_KEY(dev 形态由 index.ts 加载)。
  const apiKey = process.env.ARK_API_KEY
  if (apiKey) {
    authStorage.setRuntimeApiKey(PROVIDER, apiKey)
  }

  // 资源加载器:注入知识库系统提示词 + kb 钩子 extension
  const resourceLoader = new DefaultResourceLoader({
    cwd: appRoot,
    agentDir,
    systemPromptOverride: () => KB_SYSTEM_PROMPT,
    extensionFactories: [kbHooksFactory],
  })
  await resourceLoader.reload()

  return { authStorage, modelRegistry, resourceLoader, kbRoot, agentDir, appRoot }
}

/** 查找配置好的模型,找不到则抛错。 */
export function resolveModel(ctx: AgentContext) {
  const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID)
  if (!model) {
    throw new Error(
      `模型未找到:provider="${PROVIDER}" id="${MODEL_ID}"。请检查 .pi/agent/models.json。`,
    )
  }
  return model
}

export interface CreateChatSessionOptions {
  ctx: AgentContext
  onEvent: (event: AgentSessionEvent) => void
}

/**
 * 创建对话 agent 会话(per-WS-connection,断开即 dispose)。
 * 前端消息经 WS 进来 → session.prompt() → onEvent 推回前端。
 */
export async function createChatSession(opts: CreateChatSessionOptions): Promise<AgentSession> {
  const model = resolveModel(opts.ctx)
  const { kbRoot, agentDir, appRoot } = opts.ctx
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
  onEvent: (event: AgentSessionEvent) => void
}

/**
 * 创建后台 ingest agent 会话(每次上传新建,持久化到独立 jsonl 便于追溯)。
 * 共享对话 agent 的 loader/modelRegistry/auth,但会话独立。
 * 上传 .md → 归档 raw → session.prompt(Ingest 指令) → agent_end 推结果。
 */
export async function createIngestSession(opts: CreateIngestSessionOptions): Promise<AgentSession> {
  const model = resolveModel(opts.ctx)
  const { kbRoot, agentDir } = opts.ctx
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
