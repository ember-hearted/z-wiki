// index.ts — 薄入口:导出 createServer() 供桌面形态嵌入;start() 为 dev/CLI 入口。
// Interaction 主体在 interaction.ts,可脱离 server 启动单测 import。
// dev 形态:config.json 放项目根(由 buildAgentContext 从 appRoot 推导读取,ADR-0003 D3.1)。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, realpathSync } from 'node:fs'
import { buildAgentContext, type AgentContextOptions } from './agentHost.js'
import {
  createInteraction,
  type CreateInteractionOptions,
  type Interaction,
} from './interaction.js'
import { kbRoot } from './kbLayout.js'
import { ensurePandoc } from './pandocManager.js'
import { openBrowser } from './openBrowser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dev/CLI 默认路径:从模块位置推导项目根(代码与数据同目录的开发形态)。
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'

/** 是否自动开浏览器:ZWIKI_OPEN_BROWSER 未设或 '1' 即开;'0'/'off' 关闭。 */
export function shouldOpenBrowser(env: Record<string, string | undefined>): boolean {
  const v = env.ZWIKI_OPEN_BROWSER
  return v === undefined || v === '1'
}

/**
 * webui 数据根(ZWIKI_HOME,ADR 票据 03):决定 config.json/models.json/sessions/kbRoot 的落点。
 * 缺省回退 projectRoot(dev 形态,保持现状);显式设置时整个数据根指向该目录,
 * 设成桌面 UserDataDir 即与桌面共享同一份数据(config + agent + kb)。空串视为未设(回退 projectRoot)。
 */
export function dataRootFor(env: Record<string, string | undefined>, projectRoot: string): string {
  const v = env.ZWIKI_HOME
  return v?.trim() ? v : projectRoot
}

export type { AgentContextOptions } from './agentHost.js'

/**
 * createServer 选项。webDistPath 可选:提供时 server 用 @fastify/static 同端口 serve
 * 前端构建产物(prod/桌面形态,ADR-0003 D2.1);不提供时保留 dev 占位(/ 走 vite proxy)。
 * kbExamplePath 可选:提供时 POST /api/vault 可从样板复制新建 Vault;dev 形态指仓库根 kb_example。
 */
export interface CreateServerOptions extends AgentContextOptions {
  /** web/dist 静态资源绝对路径;省略则不托管前端(dev 形态走 vite proxy)。 */
  webDistPath?: string
  /** bundle 内 kb_example 绝对路径;省略则 POST /api/vault 返回 503。 */
  kbExamplePath?: string
  /** 测试注入:替换 chat/ingest session 工厂(默认 agentHost);生产不传。 */
  sessions?: CreateInteractionOptions['sessions']
}

/**
 * 构建 server:agent context + interaction + 初始 buildView,返回已注册路由的 Fastify app(未 listen)。
 * dev 形态由 start() 调用并 listen;桌面形态由 Electron 主进程 listen 随机端口(ADR-0003 D2)。
 */
export async function createServer(opts: CreateServerOptions): Promise<Interaction> {
  const agentCtx = await buildAgentContext(opts)
  const interaction = await createInteraction(agentCtx, {
    kbRoot: opts.kbRoot,
    webDistPath: opts.webDistPath,
    kbExamplePath: opts.kbExamplePath,
    sessions: opts.sessions,
  })
  interaction.log.info('agent context ready')
  const total = await interaction.refreshView()
  interaction.log.info({ total }, 'initial buildView done')
  return interaction
}

/** dev/CLI 入口:用默认 PROJECT_ROOT 推导路径,listen。 */
async function start(): Promise<void> {
  try {
    // webui 数据根(ZWIKI_HOME,缺省项目根):config/models/sessions/kb 都从它派生。
    // 设成桌面 UserDataDir 即与桌面共享同一份数据(票据 03)。
    const dataRoot = dataRootFor(process.env, PROJECT_ROOT)
    // 确保 pandoc 可用(ADR-0007 决策 3):开发形态按需下载到 .pi/agent/bin。失败 warn 不阻塞。
    // agentDir 落 dataRoot(而非 PROJECT_ROOT),使 models/sessions/bin 与 desktop 对齐。
    const agentDir = path.join(dataRoot, '.pi/agent')
    try {
      await ensurePandoc(agentDir)
    } catch (err) {
      console.warn(
        '[z-wiki] pandoc 下载失败,非 md 文档解析将不可用:',
        err instanceof Error ? err.message : err,
      )
    }
    // 在 start() 内,webui 形态:存在 web/dist 则同端口 serve。
    const webDistPath = path.join(PROJECT_ROOT, 'web', 'dist')
    const webDistExists = existsSync(webDistPath)
    const interaction = await createServer({
      // 默认库 kb/ 落 dataRoot(与 desktop 的 kbRootFor 对齐);kb_example 模板仍随项目根。
      kbRoot: kbRoot(dataRoot),
      agentDir,
      kbExamplePath: path.join(PROJECT_ROOT, 'kb_example'),
      ...(webDistExists ? { webDistPath } : {}),
    })

    // graceful shutdown:进程收到退出信号(Ctrl+C / app 退出)时,
    // 若有活跃 WebSocket 句柄 fastify 不会自行退出,会被反复 force kill。
    let closing = false
    const shutdown = async (signal: string): Promise<void> => {
      if (closing) return
      closing = true
      interaction.log.info({ signal }, 'shutting down')
      await interaction.app.close()
      process.exit(0)
    }
    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))

    await interaction.app.listen({ port: PORT, host: HOST })
    interaction.log.info(`z-wiki server on http://${HOST}:${PORT}`)
    if (shouldOpenBrowser(process.env)) {
      void openBrowser(`http://${HOST}:${PORT}/`)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

// 仅在作为入口直接执行时启动(被 import 时不跑,供测试与桌面形态嵌入)。
// realpathSync 处理 mac /tmp→/private/tmp 等 symlink,避免误判。
function isMainEntry(): boolean {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}
if (isMainEntry()) void start()
