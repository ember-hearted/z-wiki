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
  applyModelToSessions,
  createChatSession,
  createIngestSession,
  reloadAgentConfig,
  resolveModel,
  withFileLock,
} from './agentHost.js'
import { API_SPECS } from './apiSpecs.js'
import { buildView, type PageMeta } from './buildView.js'
import { maskApiKey, readConfig, type VaultEntry, writeConfig } from './config.js'
import { hasIndexChanged } from './hasIndexChanged.js'
import { rawDir } from './kbLayout.js'

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
  let currentKbRoot = opts.kbRoot
  const currentVaultRoot = () => path.dirname(currentKbRoot)
  const configPath = path.join(agentCtx.appRoot, 'config.json')
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

  /** 将 pi 的 AgentSessionEvent 转成前端可消费的简化消息,推给 WS。 */
  function relayEvent(socket: WebSocket, event: unknown): void {
    const e = event as {
      type: string
      assistantMessageEvent?: { type: string; delta?: string }
      toolName?: string
      // read 的 args 形如 { file_path, offset?, limit? };其它工具各异,统一序列化
      args?: unknown
      isError?: boolean
    }
    switch (e.type) {
      case 'message_update': {
        const ae = e.assistantMessageEvent
        if (ae?.type === 'text_delta' && ae.delta) {
          socket.send(JSON.stringify({ type: 'text_delta', text: ae.delta }))
        }
        break
      }
      case 'tool_execution_start':
        socket.send(JSON.stringify({ type: 'tool_start', tool: e.toolName, args: e.args }))
        break
      case 'tool_execution_end':
        socket.send(
          JSON.stringify({ type: 'tool_end', tool: e.toolName, error: Boolean(e.isError) }),
        )
        break
      case 'agent_end': {
        // agent_end 发生在 prompt 期间,session 必在 chatSessions 中(close 才 dispose);
        // 仍用 ?. 兜底,stats 缺失时退回裸 done,前端不更新 token 面板。
        const session = chatSessions.get(socket)
        const stats = session ? serializeStats(session) : undefined
        socket.send(JSON.stringify(stats ? { type: 'done', stats } : { type: 'done' }))
        // 闭环刷新:agent 写完 wiki/output 后自动 build,有变更推 kb_updated
        void triggerBuild(socket)
        break
      }
      default:
        break
    }
  }

  /** 构建 + 通知:纯函数 buildView → 对比缓存 → 变了才换缓存并广播 kb_updated。 */
  async function triggerBuild(notify: { send: (s: string) => void } | null): Promise<void> {
    const r = await buildView(currentVaultRoot())
    if (hasIndexChanged(viewCache?.fragments ?? null, r.fragments)) {
      viewCache = r
      const payload = JSON.stringify({ type: 'kb_updated', total: r.pages.length })
      if (notify) notify.send(payload)
      broadcast(payload)
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

    const session = await createIngestSession({
      ctx: agentCtx,
      kbRoot: currentKbRoot,
      onEvent: (event) => {
        const e = event as { type: string }
        log.debug({ event: e.type }, 'ingest event')
      },
    })
    ingestSessions.add(session)

    const prompt = [
      `已上传文件 raw/${rawName}。请按 Ingest 工作流处理:`,
      `1. 读取 raw/${rawName} 内容`,
      `2. 按 §1 编译规则判断是否编译为 wiki(若该主题已积累 ≥3 篇或单篇 >100 行有独立概念价值)`,
      `3. 若值得编译:创建/更新 wiki 文章(含 frontmatter view 字段、来源引用 [[raw/${rawName}]]、反向链接),更新 index.md`,
      `4. 若内容达到产出 output 的条件(如可形成对比分析/报告),可产出 output`,
      `5. 追加 log.md`,
      `6. 若判断不值得编译,简短说明并结束`,
    ].join('\n')

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
      onEvent: (event) => relayEvent(socket, event),
    })
    // createChatSession 期间客户端可能已断开(快速刷新/网络抖动):已 close 的 socket
    // 不再触发 close 事件,若不检查会导致 session 不 dispose + chatSessions 残留 dead entry。
    if (socket.readyState !== 1 /* OPEN */) {
      log.warn('ws client disconnected during session creation, disposing session')
      session.dispose()
      return
    }
    chatSessions.set(socket, session)
    // 推初始 session 信息:模型名 + 上下文窗口,供 header 右上显示。
    // 与 createChatSession 内部用同一 resolveModel(agentCtx),model 引用一致。
    socket.send(
      JSON.stringify({ type: 'session_init', model: serializeModel(resolveModel(agentCtx)) }),
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
    // 限制类型:仅 .md
    const ext = path.extname(file.filename).toLowerCase()
    if (ext !== '.md') {
      return reply.code(415).send({ error: '仅支持 .md 文件' })
    }

    // 安全的文件名:保留原命名,去掉路径与危险字符
    const safeName = path.basename(file.filename).replace(/[^\w.一-龥-]/g, '_')
    const rawPath = path.join(rawDir(currentVaultRoot()), safeName)

    // 归档到 raw/(写锁;raw/ 对 agent 只读,但上传端点是合法写入方)
    await withFileLock(rawPath, async () => {
      await fs.mkdir(rawDir(currentVaultRoot()), { recursive: true })
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

  // ── Vault 管理 + 配置端点(ADR-0003 D4/D5/D7/D3.1)─────────────────
  // config.json 是真相源,读写均经 withFileLock 串行化(切库写 currentVault 与设置页写 apiKey 可能并发)。

  /** 把名字转为安全的目录名段(用于派生新 Vault 的 kb/ 路径)。 */
  function slugify(name: string): string {
    return (
      name
        .trim()
        .replace(/[^\w.一-龥-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'vault'
    )
  }

  /** 查 config.json 中已知 Vault 的显示名(找不到则取 kb/ 父目录名)。 */
  function vaultDisplayName(kbRootPath: string, cfg: { vaults?: VaultEntry[] }): string {
    const found = cfg.vaults?.find((v) => v.path === kbRootPath)
    return found?.name || path.basename(path.dirname(kbRootPath)) || kbRootPath
  }

  // 已知 Vault 列表 + 当前打开项(运行时真相 = currentKbRoot,config.currentVault 跟随同步)。
  app.get('/api/vaults', async () => {
    const cfg = readConfig(configPath)
    return { vaults: cfg.vaults ?? [], currentVault: currentKbRoot }
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
      apiKey: cfg.apiKey,
      hasApiKey: Boolean(cfg.apiKey),
      apiKeyMasked: maskApiKey(cfg.apiKey),
      exposedApiSpecs: cfg.exposedApiSpecs ?? [],
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
    const body = (req.body ?? {}) as { name?: string; path?: string }
    let kbRootPath: string
    if (body.path) {
      kbRootPath = path.resolve(body.path)
    } else if (body.name) {
      // 无显式路径时,在 appRoot 下派生(桌面形态 = UserDataDir,dev = 项目根)
      kbRootPath = path.join(agentCtx.appRoot, `${slugify(body.name)}-kb`)
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
    viewCache = await buildView(currentVaultRoot())

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

    // 写 config(writeConfig 规范化 baseUrl),锁内 read-modify-write 后读回规范化值喂 reload
    const updatedCfg = await withFileLock(configPath, async () => {
      const cfg = readConfig(configPath)
      cfg.baseUrl = body.baseUrl as string
      cfg.api = body.api as string
      cfg.model = body.model as string
      cfg.apiKey = body.apiKey as string
      writeConfig(configPath, cfg)
      return readConfig(configPath)
    })

    // 冷重载:refresh modelRegistry + setRuntimeApiKey + resolveModel(D5)
    // 注意:config.json 已写入,即使 reload 失败配置也已保存——错误信息须如实告知。
    let model: Model<Api>
    try {
      model = await reloadAgentConfig(agentCtx, updatedCfg)
    } catch (err) {
      return reply.code(500).send({
        error: `配置已保存但重载失败:${err instanceof Error ? err.message : String(err)}。请修正后重新载入。`,
      })
    }
    // 遍历所有活跃 session(chat + ingest)换 model,不丢上下文(pi setModel 不清 messages)
    await applyModelToSessions([...chatSessions.values(), ...ingestSessions], model)
    broadcast({ type: 'config_reloaded' })
    // 广播新 model 信息,前端 header 更新模型名/上下文窗口(model 已 reload,引用为新对象)
    broadcast({ type: 'session_init', model: serializeModel(model) })
    req.log.info('LLM config reloaded and applied to all sessions')
    return reply.send({ ok: true })
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
      const r = await buildView(currentVaultRoot())
      viewCache = r
      return r.pages.length
    },
  }
}
