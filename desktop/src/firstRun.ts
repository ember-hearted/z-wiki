// firstRun.ts — 首次启动初始化(ADR-0003 D3/D4)。
// 检测 UserDataDir 空(config.json 不存在)→ 从 bundle kb_example 复制首个 Vault →
// 写初始 config.json(currentVault + 空壳 LLM 配置,ADR-0004 D6)。
// 纯函数为主(可单测);ensureFirstRun 编排,由 main.ts 调。
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DesktopPaths } from './pathUtils.js'

/** 首次启动 = config.json 不存在(UserDataDir 未初始化)。 */
export function isFirstRun(configPath: string): boolean {
  return !existsSync(configPath)
}

/**
 * 递归复制 kb_example → kbRoot。src 必须存在(bundle 缺失是打包错误,失败快)。
 * dest 父目录(UserDataDir)由调用方保证存在或在此创建。
 */
export function copyKbExample(src: string, dest: string): void {
  if (!existsSync(src)) {
    throw new Error(`bundle 内 kb_example 不存在:${src}\n打包资源缺失,无法初始化首个 Vault。`)
  }
  mkdirSync(path.dirname(dest), { recursive: true })
  // fs.cpSync 递归复制目录;Node 22+ 稳定。避免手写递归。
  cpSync(src, dest, { recursive: true })
}

/** 初始 config.json 内容(ADR-0003 D3.1 + ADR-0004 D1/D6):空壳 LLM 配置 + 单 Vault。 */
export function initialConfig(kbRoot: string): {
  apiKey: string
  baseUrl: string
  api: string
  model: string
  exposedApiSpecs: string[]
  vaults: Array<{ path: string; name: string }>
  currentVault: string
  preferences: Record<string, unknown>
} {
  return {
    apiKey: '',
    baseUrl: '',
    api: 'openai-completions',
    model: '',
    // 与 server/src/apiSpecs.ts 的 DEFAULT_EXPOSED_SPECS 保持同步(seam 隔离无法 import,D9)。
    // 改默认暴露项时三处同改:apiSpecs.ts / config.example.json / 此处。
    exposedApiSpecs: ['openai-completions', 'anthropic-messages'],
    vaults: [{ path: kbRoot, name: '默认' }],
    currentVault: kbRoot,
    preferences: {},
  }
}

/**
 * 原子写初始 config.json(tmp+rename,避免写半崩溃损坏真相源,参照 windowState.ts)。
 * 仅在首次启动调;已存在时不覆盖(由调用方 isFirstRun 守卫)。
 */
export function writeInitialConfig(configPath: string, kbRoot: string): void {
  const tmp = `${configPath}.tmp`
  const content = JSON.stringify(initialConfig(kbRoot), null, 2)
  // writeFileSync + renameSync 同步写,简单可靠;config.json 小,无需流式。
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, configPath)
}

/**
 * 首次启动编排:复制 kb_example 到 kbRoot + 写 config.json。
 * 非首次启动(config.json 已存在)直接返回,不重复复制(验收:二次启动不重复)。
 */
export function ensureFirstRun(paths: DesktopPaths): void {
  // kb/ 缺失则补复制(无论是否首次:config.json 可能在但 kb/ 被删/未复制成功,需自愈)。
  // 原逻辑只认 config.json 不存在为首次,kb/ 被手误删后非首次启动直接 return 不补,buildAgentContext 抛错。
  if (!existsSync(paths.kbRoot)) {
    copyKbExample(paths.kbExamplePath, paths.kbRoot)
  }
  // config.json 不存在(首次启动)才写初始配置;已存在不覆盖(保留用户填的 apiKey 等)。
  if (isFirstRun(paths.configPath)) {
    writeInitialConfig(paths.configPath, paths.kbRoot)
  }
}
