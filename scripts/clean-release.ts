// clean-release.ts - 清理 release/:删其他平台完整包,保留当前 arch 完整包 + app/code 包 +
// latest.json + unpacked 缓存(ADR-0018 D7)。
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 完整包命名:z-wiki-{ver}-{os}-{arch}.{ext}[.blockmap]。os=mac/win/linux,arch=arm64/x64。 */
const COMPLETE_PKG_RE = /^z-wiki-\d+\.\d+\.\d+-(mac|win|linux)-(arm64|x64)\./

export interface CleanPlan {
  keep: string[]
  delete: string[]
}

/**
 * 规划清理:完整包(含 .blockmap)按 os-arch 分,当前 arch 保留其他删;
 * 其余(app/code 包、latest.json、unpacked 目录、builder-debug.yml 等)全保留。
 * entries 为 releaseDir 下的名字(相对),纯函数不碰 fs。
 */
export function planCleanRelease(entries: string[], currentOsArch: string): CleanPlan {
  const keep: string[] = []
  const del: string[] = []
  for (const name of entries) {
    const m = name.match(COMPLETE_PKG_RE)
    if (m) {
      const osArch = `${m[1]}-${m[2]}`
      if (osArch === currentOsArch) keep.push(name)
      else del.push(name)
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
  const plan = planCleanRelease(entries, currentOsArch(process.platform, process.arch))
  for (const name of plan.delete) {
    rmSync(path.join(releaseDir, name), { recursive: true, force: true })
  }
  process.stdout.write(
    `保留 ${plan.keep.length} 项,删除 ${plan.delete.length} 项:\n` +
      (plan.delete.length ? plan.delete.map((d) => `  - ${d}`).join('\n') + '\n' : '') +
      `release/ 清理完成。\n`,
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
