// index.ts — 薄入口:导出 createServer() 供桌面形态嵌入;startServer() 为 dev/CLI/发布包入口。
// Interaction 主体在 interaction.ts,可脱离 server 启动单测 import。
// dev 形态:config.json 放项目根(由 buildAgentContext 从 appRoot 推导读取,ADR-0003 D3.1)。
import { cpSync, existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AgentContextOptions, buildAgentContext } from './agentHost.js'
import {
  type CreateInteractionOptions,
  createInteraction,
  type Interaction,
} from './interaction.js'
import { kbRoot } from './kbLayout.js'
import { openBrowser } from './openBrowser.js'
import { ensurePandoc } from './pandocManager.js'

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
 * 桌面 app 的 UserDataDir(复刻 Electron `app.getPath('userData')` 在 app 名 'z-wiki' 下的跨平台映射,
 * 无 Electron 依赖,供 webui 探测桌面已有数据根)。Win=%APPDATA%\z-wiki;mac=~/Library/Application
 * Support/z-wiki;linux=~/.config/z-wiki。缺对应环境变量则返回空串(视为无桌面目录)。
 */
export function desktopUserDataDir(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string {
  switch (platform) {
    case 'win32':
      return env.APPDATA ? path.join(env.APPDATA, 'z-wiki') : ''
    case 'darwin':
      return env.HOME ? path.join(env.HOME, 'Library', 'Application Support', 'z-wiki') : ''
    case 'linux':
      return env.HOME ? path.join(env.HOME, '.config', 'z-wiki') : ''
    default:
      return ''
  }
}

/**
 * webui 数据根(ZWIKI_HOME,ADR 票据 03):决定 config.json/models.json/sessions/kbRoot 的落点。
 * 优先级:
 * 1. `ZWIKI_HOME` 显式设置(非空) → 用它。
 * 2. 否则自动探测桌面 UserDataDir(`desktopUserDataDir`),若其存在 → 用它(开箱即用桌面已有知识库)。
 * 3. 否则回退 fallbackDataRoot(默认为 projectRoot:dev 形态沿用项目根,发布包可传用户可写目录)。
 * exists 是路径存在性谓词(默认 existsSync),注入以便单测。
 */
export function dataRootFor(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  projectRoot: string,
  exists: (p: string) => boolean = existsSync,
  fallbackDataRoot: string = projectRoot,
): string {
  const explicit = env.ZWIKI_HOME?.trim()
  if (explicit) return explicit
  const desktopDir = desktopUserDataDir(platform, env)
  if (desktopDir && exists(desktopDir)) return desktopDir
  return fallbackDataRoot
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

export interface ServerStartOptions {
  /** 项目/包根:决定 web/dist、kb_example 的相对落点;缺省从模块位置推导(dev=仓库根,包=包安装根)。 */
  projectRoot?: string
  /** 数据根兜底:未设 ZWIKI_HOME 且无桌面数据目录时使用;发布包传用户可写目录(如 ~/.z-wiki),避免包安装目录可能只读。 */
  defaultDataRoot?: string
}

/**
 * 首跑引导:若默认库 kb/ 不存在且给了样板目录,从样板整目录复制初始化。
 * 返回是否执行了引导(bootstrap)。纯 fs 操作,便于单测。
 */
export function ensureKbBootstrapped(kb: string, example: string): boolean {
  if (existsSync(kb)) return false
  if (!existsSync(example)) return false
  cpSync(example, kb, { recursive: true })
  return true
}

/**
 * dev/CLI/发布包入口:用 projectRoot(缺省从模块位置推导)推导路径,listen。
 * 供发布包 CLI 复用;首跑缺 kb/ 且带 kb_example/ 时自动引导初始化。
 */
export async function startServer(opts: ServerStartOptions = {}): Promise<void> {
  try {
    const projectRoot = opts.projectRoot ?? PROJECT_ROOT
    // webui 数据根(ZWIKI_HOME,缺省自动探测桌面 UserDataDir):config/models/sessions/kb 都从它派生。
    const dataRoot = dataRootFor(
      process.env,
      process.platform,
      projectRoot,
      existsSync,
      opts.defaultDataRoot,
    )
    const agentDir = path.join(dataRoot, '.pi/agent')
    try {
      await ensurePandoc(agentDir)
    } catch (err) {
      console.warn(
        '[z-wiki] pandoc 下载失败,非 md 文档解析将不可用:',
        err instanceof Error ? err.message : err,
      )
    }
    const kbExamplePath = path.join(projectRoot, 'kb_example')
    // 首跑引导:dataRoot 下缺 kb/ 且包内带 kb_example/ 时自动初始化(包用户第一次 npx z-wiki-web 也能起)。
    const kbBase = kbRoot(dataRoot)
    ensureKbBootstrapped(kbBase, kbExamplePath)
    const webDistPath = path.join(projectRoot, 'web', 'dist')
    const webDistExists = existsSync(webDistPath)
    const interaction = await createServer({
      kbRoot: kbBase,
      agentDir,
      ...(existsSync(kbExamplePath) ? { kbExamplePath } : {}),
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
if (isMainEntry()) void startServer()
