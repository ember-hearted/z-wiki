// clean-release.ts - 清理 release/:删所有成品包(dmg/exe/zip/AppImage/tar.gz),
// 保留打包缓存(unpacked 目录)和 latest.json。发版后只在 release/ 留缓存，
// 成品包已在 GitHub release 上，gitignored 目录不用再占空间。
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 完整安装包:z-wiki-{ver}-{os}-{arch}.{ext}(含 .blockmap)。删。 */
const COMPLETE_PKG_RE = /^z-wiki-\d+\.\d+\.\d+-(mac|win|linux)-(arm64|x64)\./

/** 增量更新包:z-wiki-{app|code}-{ver}.tar.gz。删。 */
const TIER_PKG_RE = /^z-wiki-(?:app|code)-\d+\.\d+\.\d+\.tar\.gz$/

export interface CleanPlan {
  keep: string[]
  delete: string[]
}

/**
 * 规划清理:成品包全删,只留打包缓存(unpacked 目录) + latest.json。
 * - 完整安装包(含 .blockmap):全删
 * - app/code 增量更新包:全删
 * - 其余(latest.json、unpacked 目录、builder-debug.yml 等):保留
 * entries 为 releaseDir 下的名字(相对),纯函数不碰 fs。
 */
export function planCleanRelease(entries: string[]): CleanPlan {
  const keep: string[] = []
  const del: string[] = []
  for (const name of entries) {
    if (COMPLETE_PKG_RE.test(name) || TIER_PKG_RE.test(name)) {
      del.push(name)
    } else {
      keep.push(name)
    }
  }
  return { keep, delete: del }
}

/** process.platform + process.arch -> 命名用的 os-arch(mac-arm64 / win-x64 / linux-x64)。 */
export function currentOsArch(platform: string, arch: string): string {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux'
  return `${os}-${arch}`
}

// ===== IO main(make clean-release 调) =====

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const releaseDir = path.join(repoRoot, 'release')
  const entries = readdirSync(releaseDir)
  const plan = planCleanRelease(entries)
  for (const name of plan.delete) {
    rmSync(path.join(releaseDir, name), { recursive: true, force: true })
  }
  process.stdout.write(
    `保留 ${plan.keep.length} 项,删除 ${plan.delete.length} 项:\n` +
      (plan.delete.length ? `${plan.delete.map((d) => `  - ${d}`).join('\n')}\n` : '') +
      `release/ 清理完成。\n`,
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
