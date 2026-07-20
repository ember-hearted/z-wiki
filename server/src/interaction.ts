// interaction.ts — Interaction 模块:外部接入 + 业务编排。
// 通过 AgentHost 的窄 interface 碰 agent(pi SDK 封装),自身不知道 agent 内部。
// 持有可视数据缓存,经 HTTP 暴露给 web;编排 upload→ingest、agent_end→rebuild 闭环。

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import type { WebSocket } from '@fastify/websocket'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import {
  type AgentContext,
  applyThinkingToChatSession,
  createChatSession as defaultCreateChatSession,
  createIngestSession as defaultCreateIngestSession,
  resolveModel,
  updateConfig,
  withFileLock,
} from './agentHost.js'
import { API_SPECS } from './apiSpecs.js'
import { buildView, type PageMeta } from './buildView.js'
import {
  DEFAULT_CONTEXT_WINDOW,
  THINKING_LEVELS,
  maskApiKey,
  readConfig,
  type ThinkingLevel,
  type VaultEntry,
  writeConfig,
} from './config.js'
import { reloadLlmConfig, ConfigReloadError } from './configReload.js'
import { hasIndexChanged } from './hasIndexChanged.js'
import { buildIngestPrompt } from './ingestPrompt.js'
import { rawDir } from './kbLayout.js'
import { relayEvent, type RelayCtx } from './relayEvent.js'
import { checkUploadExt } from './uploadExts.js'
import { classifyMilestone } from './ingestProgress.js'
import { slugify, vaultDisplayName } from './vaultLayout.js'

export interface Interaction {
  app: FastifyInstance
  log: FastifyBaseLogger
  /** 初次构建填缓存,返回 pages 数量。 */
  refreshView(): Promise<number>
}

/** createInteraction 选项:Vault 相关路径 + 前端静态资源。 */
export interface CreateInteractionOptions {
  /** 初始 Vault 的 kb/ 根(agent cwd + buildView 基准,切库时更新)。 */
  kbRoot: string
  /** web/dist 静态资源绝对路径;省略则不托管前端(dev 形态走 vite proxy)。 */
  webDistPath?: string
  /** bundle 内 kb_example 路径,新建 Vault 时复制;省略则 POST /api/vault 返回 503(dev 形态可不传)。 */
  kbExamplePath?: string
  /**
   * 测试注入:替换 chat/ingest session 工厂(默认 agentHost)。生产不传。
   * node:test 无法 mock ESM 模块(Cannot redefine property),故用 DI 让回归测试可注入 mock。
   */
  sessions?: {
    createChatSession: typeof defaultCreateChatSession
    createIngestSession: typeof defaultCreateIngestSession
  }
}

/**
 * 构建 Interaction:注册路由、设置缓存与广播,返回可 listen 的 app。
 * agentCtx 必须已就绪(由调用方在 listen 前通过 AgentHost 构建)。
 * webDistPath 提供时,用 @fastify/static 同端口 serve 前端构建产物 + SPA fallback(ADR-0003 D2.1);
 * 省略时保留 dev 占位(dev 形态前端走 vite proxy,零回归)。
 */
export async function createInteraction(
  agentCtx: AgentContext,
  opts: CreateInteractionOptions,
): Promise<Interaction> {
  // 当前 Vault 的 kb/ 根:可变(切库时更新,D7)。createChatSession/createIngestSession/buildView 均从此派生,
  // 不再读 agentCtx.kbRoot(已移除)——切库只换此值,agentContext 全局单例不重建。
  // chat/ingest session 工厂:默认 agentHost,测试可经 opts.sessions 注入 mock(避免真实 LLM)。
  const createChatSession = opts.sessions?.createChatSession ?? defaultCreateChatSession
  const createIngestSession = opts.sessions?.createIngestSession ?? defaultCreateIngestSession
  const configPath = path.join(agentCtx.appRoot, 'config.json')
  // 启动优先用 config.currentVault(上次切换的库);目录被手动删则 existsSync 兜底回退 opts.kbRoot。
  const initialCfg = readConfig(configPath)
  let currentKbRoot =
    initialCfg.currentVault && existsSync(initialCfg.currentVault)
      ? initialCfg.currentVault
      : opts.kbRoot
  const kbExamplePath = opts.kbExamplePath

  // 默认 debug:让事件流(app.log.debug "pi event")与请求日志在开发期都可见;
  // 生产可用 LOG_LEVEL=info 收敛。开发期用 pino-pretty 格式化输出。
  const isDev = process.env.NODE_ENV !== 'production'
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'debug',
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
            },
          }
        : {}),
    },
  })

  await app.register(fastifyWebsocket)
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  })

  // ── 可视数据缓存:buildView 纯函数结果,agent_end 后刷新,HTTP 端点读此 ──
  let viewCache: { pages: PageMeta[]; fragments: Map<string, string> } | null = null

  // ── 活跃 session 注册表(ADR-0004 D5:reload 后遍历 setModel)──────────────
  // chatSessions:WS 连接 → 对话 session(断开即 dispose + delete)。
  // ingestSessions:后台 ingest session(完成后 dispose + delete)。
  // reload 配置时遍历两者 setModel,不丢对话上下文(pi setModel 不清 messages)。
  const chatSessions = new Map<WebSocket, AgentSession>()
  const ingestSessions = new Set<AgentSession>()

  function broadcast(msg: unknown): void {
    const data = JSON.stringify(msg)
    for (const c of chatSessions.keys()) {
      if (c.readyState === 1 /* OPEN */) c.send(data)
    }
  }

  /** 序列化 model 给前端 header 显示(只取展示所需字段)。 */
  function serializeModel(model: Model<Api>): {
    id: string
    name: string
    provider: string
    contextWindow: number
  } {
    return {
      id: model.id,
      name: model.name,
      provider: model.provider,
      contextWindow: model.contextWindow,
    }
  }

  /** 首个活跃 chat session(读 session 级运行时状态用,如思考档位;无连接时 undefined)。 */
  function firstChatSession(): AgentSession | undefined {
    return chatSessions.values().next().value
  }

  /**
   * 当前思考档位(ADR-0021):有活跃 chat session 读 session 实际值(setThinkingLevel 后的
   * 运行时真相),无活跃 session(如 GET /api/thinking 在 WS 连接前调用)回退 config 持久化值。
   * ADR-0021 起不再暴露 available 列表(reasoning 恒 true,档位恒全,前端两档切换不需要)。
   */
  function currentThinkingLevel(
    session: AgentSession | undefined,
    configLevel: ThinkingLevel,
  ): ThinkingLevel {
    return (session?.thinkingLevel as ThinkingLevel | undefined) ?? configLevel
  }

  /** 序列化 session 累计统计(前端做差值得本轮;contextUsage 反映 session 总占用)。 */
  function serializeStats(session: AgentSession): {
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
    cost: number
    contextUsage: {
      tokens: number | null
      contextWindow: number
      percent: number | null
    } | null
  } {
    const s = session.getSessionStats()
    return {
      tokens: s.tokens,
      cost: s.cost,
      contextUsage: s.contextUsage ?? null,
    }
  }

  // relayEvent 的依赖注入:agent_end 的 stats 收集(读 chatSessions + serializeStats)+ build 触发。
  // relayEvent 本体是模块级纯函数(./relayEvent.ts),此处只提供 createInteraction 闭包内的依赖。
  const relayCtx: RelayCtx = {
    getStats: (s) => {
      const session = chatSessions.get(s as WebSocket)
      return session ? serializeStats(session) : undefined
    },
    triggerBuild,
  }

  /** 构建 + 通知:纯函数 buildView → 对比缓存 → 变了才换缓存并广播 kb_updated。 */
  async function triggerBuild(notify: { send: (s: string) => void } | null): Promise<void> {
    const r = await buildView(currentKbRoot)
    if (hasIndexChanged(viewCache?.fragments ?? null, r.fragments)) {
      viewCache = r
      // 广播对象:broadcast 内部会 JSON.stringify 一次。先前传预 stringify 的字符串,
      // broadcast 再 stringify 一次(双重编码),前端 JSON.parse 得字符串而非对象,
      // msg.type 为 undefined 被忽略,kb_updated 永不触发前端重拉(ingest 后首页不刷新的根因)。
      const msg = { type: 'kb_updated' as const, total: r.pages.length }
      if (notify) notify.send(JSON.stringify(msg))
      broadcast(msg)
    }
  }

  // ── 活跃 ingest 计数(D5:切库前检查,ingest 进行中禁止切库)─────────
  let activeIngestCount = 0
  function isIngestActive(): boolean {
    return activeIngestCount > 0
  }

  /** 后台 ingest:起独立 agent session,按 Ingest 工作流编译 raw 中的文件。 */
  async function runIngest(rawName: string): Promise<void> {
    const log = app.log.child({ raw: rawName })
    activeIngestCount += 1
    broadcast({ type: 'ingest_started' })
    log.info('ingest started')

    let ingestPercent = 0
    const session = await createIngestSession({
      ctx: agentCtx,
      kbRoot: currentKbRoot,
      onEvent: (event) => {
        // 里程碑锚点进度(ADR-0019):命中且推进 -> broadcast ingest_progress。100% 由 ingest_done 承担。
        const milestone = classifyMilestone(event)
        if (milestone !== null && milestone > ingestPercent) {
          ingestPercent = milestone
          broadcast({ type: 'ingest_progress', percent: milestone })
        }
      },
    })
    ingestSessions.add(session)

    const prompt = buildIngestPrompt(rawName)

    try {
      await session.prompt(prompt)
      log.info('ingest finished')

      // 通知对话客户端:ingest 完成 + 触发 build
      broadcast({ type: 'ingest_done', raw: rawName })
      await triggerBuild(null)
    } finally {
      activeIngestCount = Math.max(0, activeIngestCount - 1)
      ingestSessions.delete(session)
      session.dispose()
    }
  }

  // 健康检查端点
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }))

  // 可视数据端点:pages 索引 + 单篇片段(供 web 运行时 fetch)
  app.get('/api/pages', async () => viewCache?.pages ?? [])
  app.get('/api/pages/:stem', async (req, reply) => {
    const stem = (req.params as { stem: string }).stem
    const frag = viewCache?.fragments.get(stem)
    if (!frag) return reply.code(404).send({ error: 'not found' })
    return reply.type('text/html').send(frag)
  })

  // WebSocket:对话事件桥
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const log = req.log
    log.info('ws client connected')

    const session = await createChatSession({
      ctx: agentCtx,
      kbRoot: currentKbRoot,
      onEvent: (event) => relayEvent(socket, event, relayCtx),
    })
    // createChatSession 期间客户端可能已断开(快速刷新/网络抖动):已 close 的 socket
    // 不再触发 close 事件,若不检查会导致 session 不 dispose + chatSessions 残留 dead entry。
    if (socket.readyState !== 1 /* OPEN */) {
      log.warn('ws client disconnected during session creation, disposing session')
      session.dispose()
      return
    }
    chatSessions.set(socket, session)
    // 推初始 session 信息:模型名 + 上下文窗口 + 思考档位,供 header 显示 + quickbar 思考开关渲染。
    // 与 createChatSession 内部用同一 resolveModel(agentCtx),model 引用一致。
    socket.send(
      JSON.stringify({
        type: 'session_init',
        model: serializeModel(resolveModel(agentCtx)),
        thinkingLevel: currentThinkingLevel(session, agentCtx.config.thinkingLevel ?? 'off'),
      }),
    )

    socket.on('message', async (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { text?: string }
      if (!msg.text) return
      try {
        await session.prompt(msg.text)
      } catch (err) {
        log.error({ err }, 'prompt failed')
        socket.send(
          JSON.stringify({ type: 'error', text: err instanceof Error ? err.message : String(err) }),
        )
      }
    })

    socket.on('close', () => {
      chatSessions.delete(socket)
      // 释放会话,移除监听。落盘文件由 pi 的 lazy-flush 策略管理:
      // 仅在出现 assistant 消息时才真正写盘,空会话不会产生文件,无需清理。
      session.dispose()
    })
  })

  // ── 上传端点:接收 .md → 归档 raw/ → 触发后台 ingest agent ─────────
  app.post('/api/upload', async (req, reply) => {
    const log = req.log

    const file = await req.file()
    if (!file) {
      return reply.code(400).send({ error: '未提供文件' })
    }
    // 限制类型:pandoc 支持的后缀白名单(ADR-0007 决策 1 + 决策 5)。校验集中在 checkUploadExt 纯函数。
    const ext = path.extname(file.filename).toLowerCase()
    const rejection = checkUploadExt(ext)
    if (rejection) {
      return reply.code(415).send(rejection)
    }

    // 安全的文件名:保留原命名,去掉路径与危险字符
    const safeName = path.basename(file.filename).replace(/[^\w.一-龥-]/g, '_')
    const rawPath = path.join(rawDir(currentKbRoot), safeName)

    // 归档到 raw/(写锁;raw/ 对 agent 只读,但上传端点是合法写入方)
    await withFileLock(rawPath, async () => {
      await fs.mkdir(rawDir(currentKbRoot), { recursive: true })
      const buf = await file.toBuffer()
      await fs.writeFile(rawPath, buf, 'utf-8')
    })
    log.info({ rawPath: safeName }, 'uploaded to raw/')

    // 立即回复客户端,ingest 在后台异步进行
    reply.send({ ok: true, raw: safeName, message: '已归档 raw/,后台编译中' })

    // 触发后台 ingest agent(不阻塞响应)
    void runIngest(safeName).catch((err) => {
      log.error({ err }, 'ingest failed')
      broadcast({
        type: 'ingest_error',
        raw: safeName,
        text: err instanceof Error ? err.message : String(err),
      })
    })
  })

  // ── Ingest 端点:接收文本内容 → raw/ → ingest agent → 返回结果 ─────
  app.post('/api/ingest', async (req, reply) => {
    const log = req.log
    const body = req.body as Record<string, unknown> | undefined
    const content = body?.content
    if (typeof content !== 'string' || !content) {
      return reply.code(400).send({ error: '缺少必填字段 content' })
    }

    const title = typeof body?.title === 'string' ? body.title : undefined
    const safeTitle = (title || 'ingest').replace(/[^\w.一-龥-]/g, '_')
    const rawName = `${safeTitle}-${Date.now()}.md`
    const rawPath = path.join(rawDir(currentKbRoot), rawName)

    await withFileLock(rawPath, async () => {
      await fs.mkdir(rawDir(currentKbRoot), { recursive: true })
      await fs.writeFile(rawPath, content, 'utf-8')
    })
    log.info({ rawPath: rawName }, 'ingest api: saved to raw/')

    // 起 ingest agent,收集 text_delta 拼出响应
    let responseText = ''
    const session = await createIngestSession({
      ctx: agentCtx,
      kbRoot: currentKbRoot,
      onEvent: (event) => {
        const e = event as { type: string; assistantMessageEvent?: { type: string; delta?: string } }
        if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta' && e.assistantMessageEvent.delta) {
          responseText += e.assistantMessageEvent.delta
        }
      },
    })

    try {
      await session.prompt(buildIngestPrompt(rawName))
      log.info('ingest api: agent finished')
    } finally {
      session.dispose()
    }

    await triggerBuild(null)

    return { raw: rawName, response: responseText || '编译完成' }
  })

  // ── Vault 管理 + 配置端点(ADR-0003 D4/D5/D7/D3.1)─────────────────
  // config.json 是真相源,读写均经 withFileLock 串行化(切库写 currentVault 与设置页写 apiKey 可能并发)。

  // 已知 Vault 列表 + 当前打开项(运行时真相 = currentKbRoot,config.currentVault 跟随同步)。
  app.get('/api/vaults', async () => {
    const cfg = readConfig(configPath)
    return {
      vaults: cfg.vaults ?? [],
      currentVault: currentKbRoot,
      currentVaultParent: path.dirname(currentKbRoot),
    }
  })

  // 活跃 ingest 状态(D5:切库前检查,前端据此禁用切库按钮)。
  app.get('/api/ingest/active', async () => ({ active: isIngestActive() }))

  // 配置状态(只读):baseUrl/api/model + apiKey(明文)+ 掩码 + 是否已填 + 暴露的 api 规范(ADR-0004 D1/D2)。
  // apiKey 明文回传:威胁模型见 ADR-0003 D3.1——config.json 本就明文存,loopback 单用户,能读它的攻击者
  // 已能读进程内存,掩码只防 UI 肩窥非安全边界。设置页眼睛切换明文/密文展示。
  app.get('/api/config/status', async () => {
    const cfg = readConfig(configPath)
    return {
      baseUrl: cfg.baseUrl,
      api: cfg.api,
      model: cfg.model,
      contextWindow: cfg.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
      apiKey: cfg.apiKey,
      hasApiKey: Boolean(cfg.apiKey),
      apiKeyMasked: maskApiKey(cfg.apiKey),
      exposedApiSpecs: cfg.exposedApiSpecs ?? [],
      shellPath: cfg.shellPath ?? '',
    }
  })

  // api 规范 manifest(ADR-0004 D2):供设置页 dropdown 渲染可选规范。
  // specs = 全量 manifest(openai-completions + anthropic-messages);exposed = config 选中的子集。
  app.get('/api/specs', async () => {
    const cfg = readConfig(configPath)
    return { specs: API_SPECS, exposed: cfg.exposedApiSpecs ?? [] }
  })

  // 新建空 Vault:从 kb_example 复制到指定路径(或 appRoot 下派生路径)→ 加入 config.vaults。
  // 不自动切换(切换走 /api/vault/switch,决策 D4)。
  app.post('/api/vault', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; path?: string; parentPath?: string }
    let kbRootPath: string
    if (body.path) {
      kbRootPath = path.resolve(body.path)
    } else if (body.parentPath && body.name) {
      // 指定父目录(原生选择器选的已存在目录):在其下派生 {slugify(name)}-kb,与 appRoot 派生同规则。
      kbRootPath = path.join(path.resolve(body.parentPath), `${slugify(body.name)}-kb`)
    } else if (body.name) {
      // 无显式路径时,在当前仓库父目录下派生(跟当前仓库同级);默认库时 dirname(currentKbRoot)=appRoot,向后兼容。
      kbRootPath = path.join(path.dirname(currentKbRoot), `${slugify(body.name)}-kb`)
    } else {
      return reply.code(400).send({ error: '需提供 name 或 path' })
    }

    if (!kbExamplePath) {
      return reply
        .code(503)
        .send({ error: '服务器未配置 kbExamplePath,无法新建 Vault(仅桌面/prod 形态支持)' })
    }
    if (!existsSync(kbExamplePath)) {
      return reply.code(500).send({ error: `bundle 内 kb_example 不存在:${kbExamplePath}` })
    }
    // 目标 kb/ 已存在则拒绝(避免覆盖既有知识库)
    if (existsSync(kbRootPath)) {
      return reply.code(409).send({ error: `目标路径已存在:${kbRootPath}` })
    }

    await fs.mkdir(path.dirname(kbRootPath), { recursive: true })
    await fs.cp(kbExamplePath, kbRootPath, { recursive: true })

    const entry: VaultEntry = {
      path: kbRootPath,
      name: body.name?.trim() || path.basename(kbRootPath),
    }
    await withFileLock(configPath, async () => {
      const cfg = readConfig(configPath)
      cfg.vaults = [...(cfg.vaults ?? []), entry]
      writeConfig(configPath, cfg)
    })

    req.log.info({ kbRootPath, name: entry.name }, 'vault created')
    return reply.code(201).send({ vault: entry })
  })

  // 切换 Vault(D7 闭环):查活跃 ingest → 409;否则换指针 + 推 vault_changed + 关所有 WS + rebuild。
  app.post('/api/vault/switch', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: string }
    if (!body.path) {
      return reply.code(400).send({ error: '需提供目标 Vault 的 path(kb/ 绝对路径)' })
    }
    const targetKbRoot = path.resolve(body.path)
    if (targetKbRoot === currentKbRoot) {
      return reply.code(400).send({ error: '目标 Vault 即为当前 Vault' })
    }
    if (!existsSync(targetKbRoot)) {
      return reply.code(400).send({ error: `目标 Vault 不存在:${targetKbRoot}` })
    }
    // D5:活跃 ingest 中禁止切库(已绑旧库 cwd 的 ingest 会与新库状态分裂)
    if (isIngestActive()) {
      return reply.code(409).send({ error: '有上传正在处理,请等待完成后再切换 Vault' })
    }

    // 换指针:currentKbRoot + config.currentVault(串行化写,锁内 read-modify-write 保证原子)
    currentKbRoot = targetKbRoot
    const updatedCfg = await withFileLock(configPath, async () => {
      const cfg = readConfig(configPath)
      cfg.currentVault = targetKbRoot
      writeConfig(configPath, cfg)
      return cfg
    })

    // rebuild buildView(扫新 Vault),更新 viewCache——reply 前完成,前端重连后 /api/pages 即新内容。
    viewCache = await buildView(currentKbRoot)

    const vaultInfo = { path: targetKbRoot, name: vaultDisplayName(targetKbRoot, updatedCfg) }
    // 先推 vault_changed(显式信号,前端据此清空消息 + 区分切库重连),再 close 复用 on('close') 清理。
    broadcast({ type: 'vault_changed', vault: vaultInfo })
    for (const c of chatSessions.keys()) {
      if (c.readyState === 1 /* OPEN */) c.close()
    }

    req.log.info({ vault: vaultInfo }, 'vault switched')
    return reply.send({ vault: vaultInfo })
  })

  // 删除 Vault:从 config.vaults 移除 + 删 kb/ 目录。不能删当前打开的库(先切到其他库再删)。
  // ingest 绑 currentKbRoot,删非当前库不影响 ingest,故不检查 ingest 活跃。
  app.post('/api/vault/delete', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: string }
    if (!body.path) {
      return reply.code(400).send({ error: '需提供要删除的 Vault 的 path(kb/ 绝对路径)' })
    }
    const targetKbRoot = path.resolve(body.path)
    if (targetKbRoot === currentKbRoot) {
      return reply.code(400).send({ error: '不能删除当前打开的知识库,请先切换到其他知识库' })
    }

    let existed = false
    await withFileLock(configPath, async () => {
      const cfg = readConfig(configPath)
      const before = cfg.vaults ?? []
      const remaining = before.filter((v) => v.path !== targetKbRoot)
      if (remaining.length === before.length) return
      cfg.vaults = remaining
      writeConfig(configPath, cfg)
      existed = true
    })
    if (!existed) {
      return reply.code(404).send({ error: `未在 config.vaults 中找到该 Vault:${targetKbRoot}` })
    }

    // 删 kb/ 目录:config 已是真相源(移除成功)。目录删除失败不回滚 config——
    // 真相源正确即可,残留目录可手动清理,避免回滚后又与 config 不一致。
    try {
      await fs.rm(targetKbRoot, { recursive: true, force: true })
    } catch (err) {
      req.log.error({ err, path: targetKbRoot }, 'remove vault dir failed after config removal')
      return reply.code(500).send({
        error: `已从配置移除,但删除目录失败:${err instanceof Error ? err.message : String(err)}`,
      })
    }

    req.log.info({ path: targetKbRoot }, 'vault deleted')
    return reply.send({ ok: true })
  })

  // 修改 LLM 配置(ADR-0004 D5/D7):写 config.json + 冷重载(modelRegistry.refresh +
  // 遍历 chat/ingest session.setModel),不丢对话上下文。替代老的 PUT /api/config/apikey。
  // 空 apiKey/baseUrl/api/model → 400(Q4.1d:UI 提前拦 + 后端校验兜底)。
  app.post('/api/config/llm', async (req, reply) => {
    const body = (req.body ?? {}) as {
      baseUrl?: string
      api?: string
      model?: string
      apiKey?: string
      contextWindow?: number
    }
    // 校验:4 字段都必须是非空字符串(防空 + 防非字符串类型,coding-style 边界校验)
    const required: Array<[unknown, string]> = [
      [body.apiKey, 'apiKey'],
      [body.baseUrl, 'baseUrl'],
      [body.api, 'api'],
      [body.model, 'model'],
    ]
    for (const [val, name] of required) {
      if (typeof val !== 'string' || !val) {
        return reply.code(400).send({ error: `需提供 ${name}` })
      }
    }
    // contextWindow:提供时必须是正整数(前端 input type=number 转 number 发;容 string,Number 兜底)。
    // undefined → 不覆盖(保留原值);非法 → 400(与 4 字段校验同构)。
    const contextWindowNum =
      body.contextWindow === undefined ? undefined : Number(body.contextWindow)
    if (
      contextWindowNum !== undefined &&
      (!Number.isInteger(contextWindowNum) || contextWindowNum <= 0)
    ) {
      return reply.code(400).send({ error: 'contextWindow 必须是正整数' })
    }

    // 冷重载(configReload.ts 编排:updateConfig 写 -> reloadAgentConfig reload -> applyModelToSessions apply,
    // 不丢上下文 D5)。失败分 stage:reload 失败="配置已保存但重载失败";apply 失败="已保存且重载成功但换
    // model 失败"(修原先 apply 无 catch 的潜伏 unhandled)。失败一律不广播。mutator 决定改哪些字段。
    let model: Model<Api>
    try {
      model = await reloadLlmConfig(
        { configPath, agentCtx, getSessions: () => [...chatSessions.values(), ...ingestSessions] },
        (cfg) => ({
          ...cfg,
          baseUrl: body.baseUrl as string,
          api: body.api as string,
          model: body.model as string,
          apiKey: body.apiKey as string,
          // contextWindow:仅在提供时覆盖(条件展开,保持原"undefined 不改"语义)
          ...(contextWindowNum !== undefined ? { contextWindow: contextWindowNum } : {}),
        }),
      )
    } catch (err) {
      if (err instanceof ConfigReloadError) {
        return reply.code(500).send({
          error:
            err.stage === 'reload'
              ? `${err.message}。请修正后重新载入。`
              : `${err.message}。新会话将用新配置,请重试或刷新。`,
        })
      }
      throw err
    }
    broadcast({ type: 'config_reloaded' })
    // 广播新 model 信息 + 思考档位,前端 header 更新模型名/上下文窗口(model 已 reload,引用为新对象)。
    // reasoning 恒 true 后 setModel 不再 clamp thinkingLevel(ADR-0021),档位原样带回去即可。
    broadcast({
      type: 'session_init',
      model: serializeModel(model),
      thinkingLevel: currentThinkingLevel(
        firstChatSession(),
        agentCtx.config.thinkingLevel ?? 'off',
      ),
    })
    req.log.info('LLM config reloaded and applied to all sessions')
    return reply.send({ ok: true })
  })

  // 修改 Git Bash 路径(ADR-0003 D6 预留的 shellPath 覆盖口子):只写 config.json 真相源,
  // 不运行时写 pi 的 settings.json——派生只在 buildAgentContext(启动)做,避免与 pi 运行时写该文件的并发竞态。
  // 改后需重启 app 生效:pi 的 settingsManager 在 session 创建时读 settings.json,已存在 session 不重读,
  // 故无 LLM 那种冷重载机制(reloadAgentConfig 只管 model)。空字符串 = 清空,走 pi 自动探测。
  app.post('/api/config/shell', async (req, reply) => {
    const body = (req.body ?? {}) as { shellPath?: string }
    if (typeof body.shellPath !== 'string') {
      return reply.code(400).send({ error: '需提供 shellPath(字符串,空表示走自动探测)' })
    }
    await updateConfig(configPath, (cfg) => ({ ...cfg, shellPath: body.shellPath as string }))
    req.log.info(
      { shellPath: body.shellPath ? '<set>' : '<empty>' },
      'shellPath saved, restart required',
    )
    return reply.send({ ok: true, restartRequired: true })
  })

  // 查询思考档位(ADR-0021):level 来自活跃 chat session,无 session 回退 config。
  // 前端 WS 连接前初始渲染用;连上后 session_init 覆盖准确值。
  app.get('/api/thinking', async () => {
    return {
      level: currentThinkingLevel(firstChatSession(), agentCtx.config.thinkingLevel ?? 'off'),
    }
  })

  // 修改思考模式(ADR-0004 D8 / ADR-0021):写 config + 当前 chat session.setThinkingLevel,不丢上下文。
  // 只切 chat session(ingest 保持 off,后台编译不需思考)。返回实际生效 level(防 clamp 误导)。
  app.post('/api/config/thinking', async (req, reply) => {
    const body = (req.body ?? {}) as { level?: string }
    if (typeof body.level !== 'string' || !THINKING_LEVELS.includes(body.level as ThinkingLevel)) {
      return reply.code(400).send({ error: '需提供合法 level(off/minimal/low/medium/high/xhigh)' })
    }
    const level = body.level as ThinkingLevel
    // 写 config(真相源),updateConfig 锁内 read-modify-write
    await updateConfig(configPath, (cfg) => ({ ...cfg, thinkingLevel: level }))
    agentCtx.config.thinkingLevel = level
    // 只切 chat session,不切 ingest(后台编译保持 off)
    const actual = applyThinkingToChatSession([...chatSessions.values()], level)
    // 广播思考档位(setThinkingLevel clamp 后 level 可能变,带实际值防误导)
    broadcast({
      type: 'thinking_changed',
      thinkingLevel: currentThinkingLevel(firstChatSession(), level),
    })
    req.log.info({ requested: level, actual }, 'thinking level saved and applied to chat sessions')
    return reply.send({ level: actual })
  })

  // 前端静态资源托管(ADR-0003 D2.1):prod/桌面形态同端口 serve web/dist,
  // SPA + API 同源,前端相对路径 fetch 零改造。dev 形态(webDistPath 省略)走 vite proxy。
  if (opts.webDistPath) {
    await app.register(fastifyStatic, {
      root: opts.webDistPath,
      prefix: '/',
      decorateReply: true,
    })
    // SPA fallback:非 /api 的 GET 请求(如 /pages/:stem)回退到 index.html,交给前端路由。
    // /api/* 仍走 JSON 404,不被吞成 index.html。
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'not found' })
    })
  } else {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/plain')
        .send(
          'z-wiki server. 开发模式请访问 vite dev server;prod 形态由 desktop 主进程传入 webDistPath 托管。',
        ),
    )
  }

  return {
    app,
    log: app.log,
    refreshView: async () => {
      const r = await buildView(currentKbRoot)
      viewCache = r
      return r.pages.length
    },
  }
}
