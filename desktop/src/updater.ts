// updater.ts - 自建增量更新决策 + IO(ADR-0018 D1/D2)。
// 决策层(纯函数):selectUpdatePackage 三档比对 + .update-state.json 读写。
// IO 层(Ticket 04):fetch latest.json -> 下载 -> sha512 -> 原子覆盖 4 处 -> 更新状态。
// 不含重启(调用方据 UpdateResult 提示用户)。
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 本地已安装状态(存 .update-state.json)。platform = process.platform。 */
export interface LocalState {
  appVersion: string
  depsVersion: string
  baselineVersion: string
  platform: string
}

/** 单个包的下载信息。 */
export interface PackageInfo {
  url: string
  sha512: string
  size: number
}

/** 远程 latest.json(ADR-0018 决策 3)。full 按平台 map(Ticket 06 填)。 */
export interface RemoteManifest {
  appVersion: string
  depsVersion: string
  baselineVersion: string
  packages: {
    code?: PackageInfo
    app?: PackageInfo
    full?: Record<string, PackageInfo>
  }
}

/** 更新决策:下哪档包 + 对应包信息。 */
export interface UpdatePlan {
  action: 'none' | 'full' | 'app' | 'code'
  package: PackageInfo | null
}

/**
 * 三档比对从重到轻选包(ADR-0018 D2):
 * - 无变化 -> none
 * - linux:AppImage 只读(D6),任何更新都走完整包
 * - baselineVersion 变(runtime/二进制升级)-> full
 * - depsVersion 变(第三方依赖升级)-> app
 * - appVersion 变(项目代码)-> code
 * full 档 package 选取(按平台 map)在 Ticket 06,此处返回 null。
 */
export function selectUpdatePackage(local: LocalState, remote: RemoteManifest): UpdatePlan {
  const hasUpdate =
    local.appVersion !== remote.appVersion ||
    local.depsVersion !== remote.depsVersion ||
    local.baselineVersion !== remote.baselineVersion
  if (!hasUpdate) return { action: 'none', package: null }

  // linux:AppImage 只读不能覆盖内部(D6),任何更新都下完整 AppImage。
  if (local.platform === 'linux') return { action: 'full', package: null }

  if (local.baselineVersion !== remote.baselineVersion) {
    return { action: 'full', package: null }
  }
  if (local.depsVersion !== remote.depsVersion) {
    return { action: 'app', package: remote.packages.app ?? null }
  }
  if (local.appVersion !== remote.appVersion) {
    return { action: 'code', package: remote.packages.code ?? null }
  }
  return { action: 'none', package: null }
}

/** 读本地 .update-state.json;不存在/解析失败返回 null。 */
export async function readUpdateState(filePath: string): Promise<LocalState | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as LocalState
  } catch {
    return null
  }
}

/** 写本地 .update-state.json(原子:tmp + rename)。 */
export async function writeUpdateState(filePath: string, state: LocalState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
  await fs.rename(tmp, filePath)
}

// ===== IO 层(Ticket 04;不单测,靠 typecheck + 手动验证) =====

/** 代码包覆盖的 4 处路径(相对 resourcesDir;对应 scripts/package-update-bundles.ts collectCodePatchEntries)。 */
const CODE_PATCH_PATHS = [
  'app/dist',
  'app/node_modules/@z-wiki/server',
  'web/dist',
  'app/package.json',
]

/** fetch 远程 latest.json。 */
export async function fetchLatestManifest(feedUrl: string): Promise<RemoteManifest> {
  const res = await fetch(feedUrl)
  if (!res.ok) throw new Error(`fetch latest.json 失败:${res.status}`)
  return (await res.json()) as RemoteManifest
}

/** 下载包到 destPath。 */
export async function downloadPackage(pkg: PackageInfo, destPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  const res = await fetch(pkg.url)
  if (!res.ok) throw new Error(`下载失败:${res.status} ${pkg.url}`)
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()))
}

/** 校验文件 sha512。 */
export function verifySha512(filePath: string, expected: string): boolean {
  return createHash('sha512').update(readFileSync(filePath)).digest('hex') === expected
}

/**
 * 应用代码包:解压 tar.gz 到临时目录 -> 原子覆盖 4 处(旧 -> .old,新 -> 目标)。
 * mac/linux 重命名(inode 机制,运行中可替换);win .node 锁定规避留 Ticket 06。
 * .old 留重启后清(cleanupOldPatches)。
 */
export async function applyCodePatch(tarballPath: string, resourcesDir: string): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-patch-'))
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', tmpDir])
    for (const rel of CODE_PATCH_PATHS) {
      const target = path.join(resourcesDir, rel)
      const extracted = path.join(tmpDir, rel)
      if (!existsSync(extracted)) throw new Error(`代码包缺失:${rel}`)
      const old = `${target}.old`
      if (existsSync(target)) {
        await fs.rm(old, { recursive: true, force: true })
        await fs.rename(target, old)
      }
      await fs.rename(extracted, target)
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/** 启动时清理上次代码包更新留下的 .old。 */
export async function cleanupOldPatches(resourcesDir: string): Promise<void> {
  for (const rel of CODE_PATCH_PATHS) {
    const old = path.join(resourcesDir, `${rel}.old`)
    if (existsSync(old)) await fs.rm(old, { recursive: true, force: true })
  }
}

export interface UpdateResult {
  action: 'none' | 'applied' | 'full' | 'app'
  message: string
}

/**
 * 主流程:fetch latest.json -> 决策 -> 下载 -> 校验 -> 覆盖 -> 更新状态。
 * - 无本地状态(首次安装) -> none(跳过,首次初始化留后续)
 * - code 档 -> 自动下载覆盖,返回 applied(调用方提示重启)
 * - app/full 档 -> 降级提示下完整包(首版不自动处理,Ticket 05/06)
 * 不重启(调用方据 result 提示用户)。
 */
export async function checkForUpdate(opts: {
  feedUrl: string
  statePath: string
  cacheDir: string
  resourcesDir: string
  platform: string
}): Promise<UpdateResult> {
  const local = await readUpdateState(opts.statePath)
  if (!local) return { action: 'none', message: '首次安装无状态,跳过更新检查' }

  const remote = await fetchLatestManifest(opts.feedUrl)
  const plan = selectUpdatePackage(local, remote)
  if (plan.action === 'none') return { action: 'none', message: '已是最新' }
  if (plan.action !== 'code') {
    return { action: plan.action, message: `${plan.action} 档需下完整包(首版不自动处理)` }
  }
  if (!plan.package) throw new Error('code 包缺失于 latest.json')

  // latest.json 的 url 可能是相对文件名(02 脚本生成),基于 feedUrl 解析成绝对。
  const absUrl = new URL(plan.package.url, opts.feedUrl).toString()
  const dest = path.join(opts.cacheDir, path.basename(plan.package.url))
  await downloadPackage({ ...plan.package, url: absUrl }, dest)
  if (!verifySha512(dest, plan.package.sha512)) {
    await fs.rm(dest, { force: true })
    throw new Error('sha512 校验失败')
  }
  await applyCodePatch(dest, opts.resourcesDir)
  await writeUpdateState(opts.statePath, {
    appVersion: remote.appVersion,
    depsVersion: remote.depsVersion,
    baselineVersion: remote.baselineVersion,
    platform: opts.platform,
  })
  return { action: 'applied', message: '代码包已应用,重启生效' }
}
