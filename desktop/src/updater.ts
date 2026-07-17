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

/** 取错误消息(unknown -> string)。 */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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

/** 远程 latest.json(ADR-0018 决策 3)。full 按平台 map,键 = fullPackageKey(mac-x64/win-x64/linux-x64)。 */
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
 * latest.json full map 的键:electron-builder ${os}-${arch} 命名(ADR-0018 D4)。
 * ${os} = mac/win/linux,与 process.platform 的 darwin/win32/linux 不同,需映射;arch 一致。
 */
export function fullPackageKey(platform: string, arch: string): string {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
  return `${os}-${arch}`
}

/**
 * 三档比对从重到轻选包(ADR-0018 D2):
 * - 无变化 -> none
 * - linux:AppImage 只读(D6),任何更新都走完整包
 * - baselineVersion 变(runtime/二进制升级)-> full
 * - depsVersion 变(第三方依赖升级)-> app
 * - appVersion 变(项目代码)-> code
 * full 档按 fullPackageKey(platform, arch) 从 full map 取本平台条目;缺条目返回 null(调用方降级提示)。
 */
export function selectUpdatePackage(
  local: LocalState,
  remote: RemoteManifest,
  arch: string,
): UpdatePlan {
  const hasUpdate =
    local.appVersion !== remote.appVersion ||
    local.depsVersion !== remote.depsVersion ||
    local.baselineVersion !== remote.baselineVersion
  if (!hasUpdate) return { action: 'none', package: null }

  const fullPkg = remote.packages.full?.[fullPackageKey(local.platform, arch)] ?? null

  // linux:AppImage 只读不能覆盖内部(D6),任何更新都下完整 AppImage。
  if (local.platform === 'linux') return { action: 'full', package: fullPkg }

  if (local.baselineVersion !== remote.baselineVersion) {
    return { action: 'full', package: fullPkg }
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

// ===== IO 层(Ticket 04/06;applyPendingUpdate 单测,其余靠 typecheck + 手动验证) =====

/** 代码包覆盖的 4 处路径(相对 resourcesDir;对应 scripts/package-update-bundles.ts collectCodePatchEntries)。 */
export const CODE_PATCH_PATHS = [
  'app/dist',
  'app/node_modules/@z-wiki/server',
  'web/dist',
  'app/package.json',
]

/** 应用包覆盖的 2 处(整个 app/ + web/dist/;对应 collectAppBundleEntries)。 */
export const APP_BUNDLE_PATHS = ['app', 'web/dist']

/** staging 目录里记录待应用更新的文件名(win 路径,见 stagePackage/applyPendingUpdate)。 */
export const PENDING_FILE = 'pending.json'

/** staging 的 pending.json 内容:待应用更新(下次启动早期替换 + 版本号写回 state)。 */
export interface PendingUpdate {
  tier: 'code' | 'app'
  appVersion: string
  depsVersion: string
  baselineVersion: string
  platform: string
}

/** 失败阶段(Ticket 08):fetch/download/verify 自动重试可恢复(silent 只 log);apply 需用户行动(弹窗)。 */
export type UpdatePhase = 'fetch' | 'download' | 'verify' | 'apply'

/** 更新失败(带阶段);checkForUpdate 外层 catch 按 phase 归一化为 error result。 */
export class UpdateError extends Error {
  constructor(
    readonly phase: UpdatePhase,
    message: string,
  ) {
    super(message)
    this.name = 'UpdateError'
  }
}

/** fetch 远程 latest.json。 */
export async function fetchLatestManifest(feedUrl: string): Promise<RemoteManifest> {
  const res = await fetch(feedUrl)
  if (!res.ok) throw new UpdateError('fetch', `fetch latest.json 失败:${res.status}`)
  return (await res.json()) as RemoteManifest
}

/** 下载包到 destPath。 */
export async function downloadPackage(pkg: PackageInfo, destPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  const res = await fetch(pkg.url)
  if (!res.ok) throw new UpdateError('download', `下载失败:${res.status} ${pkg.url}`)
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()))
}

/** 校验文件 sha512。 */
export function verifySha512(filePath: string, expected: string): boolean {
  return createHash('sha512').update(readFileSync(filePath)).digest('hex') === expected
}

/**
 * 把 srcRoot 下的 relPaths 原子替换到 destRoot(目标存在则先 rename 为 .old,重启后由
 * cleanupOldPatches 清)。mac/linux 运行中可 rename(inode 机制);win 只能在启动早期调
 * (native .node 未加载)。missing=skip 用于重试续传(上次半替换的条目不再搬)。
 */
export async function replaceEntries(
  srcRoot: string,
  destRoot: string,
  relPaths: string[],
  missing: 'throw' | 'skip',
): Promise<void> {
  for (const rel of relPaths) {
    const src = path.join(srcRoot, rel)
    if (!existsSync(src)) {
      if (missing === 'throw') throw new Error(`更新包缺失:${rel}`)
      continue
    }
    const target = path.join(destRoot, rel)
    const old = `${target}.old`
    if (existsSync(target)) {
      await fs.rm(old, { recursive: true, force: true })
      await fs.rename(target, old)
    }
    await fs.rename(src, target)
  }
}

/**
 * 覆盖失败回滚(Ticket 08):把 replaceEntries 已搬走的 .old 还原回目标,best-effort。
 * mac 路径用(失败 -> 还原旧版,app 可继续用旧版);win staging 走续传语义不用。
 */
export async function restoreOldPatches(resourcesDir: string, relPaths: string[]): Promise<void> {
  for (const rel of relPaths) {
    const target = path.join(resourcesDir, rel)
    const old = `${target}.old`
    if (!existsSync(old)) continue
    try {
      await fs.rm(target, { recursive: true, force: true })
      await fs.rename(old, target)
    } catch {
      // best-effort:还原失败保留现状,外层提示用户下完整包
    }
  }
}

/**
 * 应用代码包:解压 tar.gz 到临时目录 -> 原子覆盖 4 处(mac/linux 运行中替换,04 已验证)。
 * 失败回滚 .old 还原旧版。win 不走此路径(见 stagePackage)。.old 留重启后清(cleanupOldPatches)。
 */
export async function applyCodePatch(tarballPath: string, resourcesDir: string): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-patch-'))
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', tmpDir])
    await replaceEntries(tmpDir, resourcesDir, CODE_PATCH_PATHS, 'throw')
  } catch (err) {
    await restoreOldPatches(resourcesDir, CODE_PATCH_PATHS)
    throw new UpdateError('apply', errMsg(err))
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * 应用应用包:解压 tar.gz -> 原子替换 app/ + web/dist/(mac/linux 运行中替换)。
 * 整体替换 app/ 含 node_modules,不用处理内部增删改。失败回滚。.old 留重启后清。
 */
export async function applyAppBundle(tarballPath: string, resourcesDir: string): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-app-'))
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', tmpDir])
    await replaceEntries(tmpDir, resourcesDir, APP_BUNDLE_PATHS, 'throw')
  } catch (err) {
    await restoreOldPatches(resourcesDir, APP_BUNDLE_PATHS)
    throw new UpdateError('apply', errMsg(err))
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * win 路径:下载校验后的包解压到 staging 目录 + 写 pending.json,不立即替换
 * (运行中替换 app/node_modules 会撞 native .node 文件锁;替换推迟到下次启动早期
 * applyPendingBoot,此时 .node 尚未加载)。
 */
export async function stagePackage(
  tarballPath: string,
  stagingDir: string,
  pending: PendingUpdate,
): Promise<void> {
  await fs.rm(stagingDir, { recursive: true, force: true })
  await fs.mkdir(stagingDir, { recursive: true })
  try {
    await execFileAsync('tar', ['-xzf', tarballPath, '-C', stagingDir])
    const relPaths = pending.tier === 'code' ? CODE_PATCH_PATHS : APP_BUNDLE_PATHS
    for (const rel of relPaths) {
      if (!existsSync(path.join(stagingDir, rel))) {
        throw new Error(`更新包缺失:${rel}`)
      }
    }
    await fs.writeFile(
      path.join(stagingDir, PENDING_FILE),
      JSON.stringify(pending, null, 2),
      'utf-8',
    )
  } catch (err) {
    // 失败清 staging:半写残留(无 pending.json)会让 win 分支短路卡死后续更新
    await fs.rm(stagingDir, { recursive: true, force: true })
    throw new UpdateError('apply', errMsg(err))
  }
}

/** 读 staging 的 pending.json;不存在/解析失败返回 null。 */
export async function readPendingUpdate(stagingDir: string): Promise<PendingUpdate | null> {
  try {
    const content = await fs.readFile(path.join(stagingDir, PENDING_FILE), 'utf-8')
    return JSON.parse(content) as PendingUpdate
  } catch {
    return null
  }
}

/**
 * 启动早期应用 staging 里的待替换更新(applyPendingBoot 调,此时 native .node 未加载):
 * 按 tier 替换 -> 版本号写回 .update-state.json -> 删 staging。无 pending 返回 false。
 * staging 存在但 pending.json 无效 = 损坏残留(半写),清掉避免 win 分支短路卡死后续更新。
 * 单条目 skip(重试续传上次半替换);中途抛错 staging 保留,下次启动(或 retry)再续。
 */
export async function applyPendingUpdate(
  stagingDir: string,
  resourcesDir: string,
  statePath: string,
): Promise<boolean> {
  const pending = await readPendingUpdate(stagingDir)
  if (!pending) {
    if (existsSync(stagingDir)) await fs.rm(stagingDir, { recursive: true, force: true })
    return false
  }
  const relPaths = pending.tier === 'code' ? CODE_PATCH_PATHS : APP_BUNDLE_PATHS
  await replaceEntries(stagingDir, resourcesDir, relPaths, 'skip')
  await writeUpdateState(statePath, {
    appVersion: pending.appVersion,
    depsVersion: pending.depsVersion,
    baselineVersion: pending.baselineVersion,
    platform: pending.platform,
  })
  await fs.rm(stagingDir, { recursive: true, force: true })
  return true
}

/** 启动时清理上次更新留下的 .old(代码包 4 处 + 应用包 app/)。 */
export async function cleanupOldPatches(resourcesDir: string): Promise<void> {
  for (const rel of [...CODE_PATCH_PATHS, ...APP_BUNDLE_PATHS]) {
    const old = path.join(resourcesDir, `${rel}.old`)
    if (existsSync(old)) await fs.rm(old, { recursive: true, force: true })
  }
}

export interface UpdateResult {
  action: 'none' | 'applied' | 'full' | 'error'
  message: string
  /** full 档完整包下载地址 / error 降级"去下载"(latest.json 有本平台条目时)。 */
  downloadUrl?: string
  /** 网络/校验类失败静默(只 log 不弹窗,下次启动自动重试);apply 失败需用户行动才弹窗。 */
  silent?: boolean
}

/**
 * 主流程:fetch latest.json -> 决策 -> 下载 -> 校验 -> 应用 -> 更新状态。
 * - 无本地状态(首次安装) -> none(跳过,首次初始化留后续)
 * - code/app 档 mac -> 自动下载覆盖,返回 applied(调用方提示重启);失败回滚旧版 -> error
 * - code/app 档 win -> 下载解压到 stagingDir,替换推迟到下次启动早期(applyPendingBoot,避开 .node 锁定)
 * - full 档 linux -> 下载新 AppImage 同目录原子替换(D6/D8);非 AppImage 形态降级提示
 * - full 档 mac/win -> 完整包是安装器,不自动覆盖 runtime/二进制,返回 downloadUrl 提示重装
 * - 失败降级(Ticket 08):fetch/download/verify 失败 -> silent error(自动重试,不打扰);
 *   apply 失败 -> error + downloadUrl(弹窗:mac translocation 提示拖 Applications,其他提示下完整包)
 * 不重启(调用方据 result 提示用户)。
 */
export async function checkForUpdate(opts: {
  feedUrl: string
  statePath: string
  cacheDir: string
  stagingDir: string
  resourcesDir: string
  platform: string
  arch: string
}): Promise<UpdateResult> {
  const local = await readUpdateState(opts.statePath)
  if (!local) return { action: 'none', message: '首次安装无状态,跳过更新检查' }

  let remote: RemoteManifest
  try {
    remote = await fetchLatestManifest(opts.feedUrl)
  } catch (err) {
    return {
      action: 'error',
      silent: true,
      message: `检查更新失败(网络),下次启动自动重试:${errMsg(err)}`,
    }
  }

  const plan = selectUpdatePackage(local, remote, opts.arch)
  if (plan.action === 'none') return { action: 'none', message: '已是最新' }

  // latest.json 的 url 可能是相对文件名(02 脚本生成),基于 feedUrl 解析成绝对。
  const absUrl = plan.package ? new URL(plan.package.url, opts.feedUrl).toString() : undefined
  // 本平台完整包条目:失败降级"去下载"用
  const fullPkg = remote.packages.full?.[fullPackageKey(opts.platform, opts.arch)]
  const fullUrl = fullPkg ? new URL(fullPkg.url, opts.feedUrl).toString() : undefined

  try {
    if (plan.action === 'full') {
      // linux:完整包 = AppImage 单文件,可自动替换(下新文件覆盖,不走资源内部覆盖)。
      if (opts.platform === 'linux' && plan.package && absUrl) {
        const appImagePath = process.env.APPIMAGE
        if (appImagePath) {
          // 下到 AppImage 同目录临时文件:rename 同目录必同盘,原子覆盖(避免跨盘 EXDEV)。
          const tmpPath = `${appImagePath}.download`
          await downloadPackage({ ...plan.package, url: absUrl }, tmpPath)
          if (!verifySha512(tmpPath, plan.package.sha512)) {
            await fs.rm(tmpPath, { force: true })
            throw new UpdateError('verify', 'sha512 校验失败')
          }
          try {
            await fs.chmod(tmpPath, 0o755)
            await fs.rename(tmpPath, appImagePath)
          } catch (err) {
            throw new UpdateError('apply', errMsg(err))
          }
          await writeUpdateState(opts.statePath, {
            appVersion: remote.appVersion,
            depsVersion: remote.depsVersion,
            baselineVersion: remote.baselineVersion,
            platform: opts.platform,
          })
          return { action: 'applied', message: '新版 AppImage 已替换,重启生效' }
        }
      }
      // mac/win(及 linux 非 AppImage 形态):提示下完整包重装。
      return {
        action: 'full',
        message: '基线层升级(Electron/工具二进制),请下载新完整包重新安装',
        downloadUrl: absUrl,
      }
    }
    if (!plan.package || !absUrl) throw new Error(`${plan.action} 包缺失于 latest.json`)

    // win:staging 已存在 = 有待应用更新,不重复下载,等重启(替换在下次启动早期)。
    if (opts.platform === 'win32' && existsSync(opts.stagingDir)) {
      return { action: 'applied', message: '更新已下载,重启 z-wiki 后生效' }
    }

    const dest = path.join(opts.cacheDir, path.basename(plan.package.url))
    await downloadPackage({ ...plan.package, url: absUrl }, dest)
    if (!verifySha512(dest, plan.package.sha512)) {
      await fs.rm(dest, { force: true })
      throw new UpdateError('verify', 'sha512 校验失败')
    }

    // win:解压到 staging,替换推迟到下次启动早期(applyPendingBoot;运行中替换会撞 .node 锁)。
    if (opts.platform === 'win32') {
      await stagePackage(dest, opts.stagingDir, {
        tier: plan.action,
        appVersion: remote.appVersion,
        depsVersion: remote.depsVersion,
        baselineVersion: remote.baselineVersion,
        platform: opts.platform,
      })
      await fs.rm(dest, { force: true })
      return { action: 'applied', message: `${plan.action} 包已下载,重启后生效` }
    }

    if (plan.action === 'code') {
      await applyCodePatch(dest, opts.resourcesDir)
    } else {
      await applyAppBundle(dest, opts.resourcesDir)
    }
    await writeUpdateState(opts.statePath, {
      appVersion: remote.appVersion,
      depsVersion: remote.depsVersion,
      baselineVersion: remote.baselineVersion,
      platform: opts.platform,
    })
    return { action: 'applied', message: `${plan.action} 包已应用,重启生效` }
  } catch (err) {
    if (!(err instanceof UpdateError)) throw err
    // download/verify:自动重试可恢复,silent 只 log;apply:需用户行动,弹窗。
    if (err.phase === 'download') {
      return {
        action: 'error',
        silent: true,
        message: `更新包下载失败(网络),下次启动自动重试:${err.message}`,
        downloadUrl: fullUrl,
      }
    }
    if (err.phase === 'verify') {
      return {
        action: 'error',
        silent: true,
        message: '更新包校验失败,已丢弃,下次启动自动重试',
        downloadUrl: fullUrl,
      }
    }
    // apply:mac translocation(从 dmg 直接运行)给专门文案,其余提示下完整包。
    const translocated = opts.resourcesDir.includes('AppTranslocation')
    return {
      action: 'error',
      message: translocated
        ? '覆盖更新失败:app 正在临时位置运行,请将 z-wiki 拖到 Applications 文件夹后再更新'
        : `覆盖更新失败,请下载完整包重新安装:${err.message}`,
      downloadUrl: fullUrl,
    }
  }
}
