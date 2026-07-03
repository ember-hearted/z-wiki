// index.ts — 薄入口:导出 createServer() 供桌面形态嵌入;start() 为 dev/CLI 入口。
// Interaction 主体在 interaction.ts,可脱离 server 启动单测 import。
// dev 形态:config.json 放项目根(由 buildAgentContext 从 appRoot 推导读取,ADR-0003 D3.1)。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { buildAgentContext, type AgentContextOptions } from './agentHost.js'
import { createInteraction, type Interaction } from './interaction.js'
import { kbRoot } from './kbLayout.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// dev/CLI 默认路径:从模块位置推导项目根(代码与数据同目录的开发形态)。
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '127.0.0.1'

export type { AgentContextOptions } from './agentHost.js'

/**
 * 构建 server:agent context + interaction + 初始 buildView,返回已注册路由的 Fastify app(未 listen)。
 * dev 形态由 start() 调用并 listen;桌面形态由 Electron 主进程 listen 随机端口(ADR-0003 D2)。
 */
export async function createServer(opts: AgentContextOptions): Promise<Interaction> {
  const agentCtx = await buildAgentContext(opts)
  const interaction = await createInteraction(agentCtx)
  interaction.log.info('agent context ready')
  const total = await interaction.refreshView()
  interaction.log.info({ total }, 'initial buildView done')
  return interaction
}

/** dev/CLI 入口:用默认 PROJECT_ROOT 推导路径,listen。 */
async function start(): Promise<void> {
  try {
    const interaction = await createServer({
      kbRoot: kbRoot(PROJECT_ROOT),
      agentDir: path.join(PROJECT_ROOT, '.pi/agent'),
    })

    // graceful shutdown:tsx watch / concurrently 在 Ctrl+C 时给子进程发信号,
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
