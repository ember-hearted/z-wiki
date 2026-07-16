// bump-version.mjs - 统一 bump 4 个 package.json 的 version(根/server/web/desktop),保持同步。
// 用法:
//   node scripts/bump-version.mjs patch    # 0.1.0 -> 0.1.1
//   node scripts/bump-version.mjs minor    # 0.1.0 -> 0.2.0
//   node scripts/bump-version.mjs major    # 0.1.0 -> 1.0.0
//   node scripts/bump-version.mjs 0.3.1    # 显式版本
// electron-builder 产物版本号读 desktop/package.json 的 version,故 4 处必须同步。
// 脚本只改文件;commit / tag(`v<ver>`)由调用方手动。
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const PKGS = ['package.json', 'server/package.json', 'web/package.json', 'desktop/package.json']
const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function readPkg(rel) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf-8'))
}

function writePkg(rel, pkg) {
  // 2 空格缩进 + 尾换行(与 biome package.json 格式一致,改完跑 make format 兜底)
  writeFileSync(path.join(REPO_ROOT, rel), `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
}

function bumpSemver(ver, kind) {
  const parts = ver.split('.').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`当前版本 ${ver} 不是 x.y.z 格式,无法 bump ${kind}`)
  }
  const [maj, min, pat] = parts
  if (kind === 'major') return `${maj + 1}.0.0`
  if (kind === 'minor') return `${maj}.${min + 1}.0`
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`
  throw new Error(`未知 bump 类型:${kind}(用 patch/minor/major 或显式 x.y.z)`)
}

const arg = process.argv[2]
if (!arg || arg === '-h' || arg === '--help') {
  console.error('用法: node scripts/bump-version.mjs <patch|minor|major|x.y.z>')
  process.exit(arg ? 0 : 1)
}

const current = readPkg(PKGS[0]).version
const next = /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg) ? arg : bumpSemver(current, arg)
if (next === current) {
  console.error(`新版本 ${next} 与当前 ${current} 相同,未改动`)
  process.exit(1)
}

// 4 处当前版本一致性检查(历史漂移则警告,仍统一到 next)
const before = PKGS.map((p) => readPkg(p).version)
const drifted = before.some((v) => v !== current)
if (drifted) {
  console.warn(`⚠ 4 处版本不一致:${PKGS.map((p, i) => `${p}=${before[i]}`).join(', ')}`)
  console.warn(`  以根 ${current} 为基准 bump 到 ${next},统一。`)
}

for (const [i, p] of PKGS.entries()) {
  const pkg = readPkg(p)
  pkg.version = next
  writePkg(p, pkg)
  console.log(`✓ ${p}: ${before[i]} -> ${next}`)
}
console.log(
  `\n版本已 bump 到 ${next}。建议:git diff 确认 -> commit -> tag v${next} -> make package`,
)
