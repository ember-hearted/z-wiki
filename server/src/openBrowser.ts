import { spawn } from 'node:child_process'

/** 跨平台打开默认浏览器访问 url。返回 argv(不含 shell),纯函数便于单测。 */
export function browserOpenCommand(platform: NodeJS.Platform, url: string): string[] {
  switch (platform) {
    case 'win32':
      return ['cmd', '/c', 'start', '', url]
    case 'darwin':
      return ['open', url]
    default:
      return ['xdg-open', url]
  }
}

/** 打开默认浏览器。失败不抛(webui 不应因打不开浏览器而崩),resolve(false);成功 resolve(true)。 */
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      new URL(url)
    } catch {
      resolve(false)
      return
    }
    const [cmd, ...args] = browserOpenCommand(process.platform, url)
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.once('error', () => resolve(false))
    child.once('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}
