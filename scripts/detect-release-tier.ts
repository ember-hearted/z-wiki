// detect-release-tier.ts — 发版分层检测:比较当前与上次发版的版本号,输出自动推荐的打包范围。
// 用法:
//   npx tsx scripts/detect-release-tier.ts              # JSON 到 stdout
//   npx tsx scripts/detect-release-tier.ts --tier-only   # 只输出 code/app/full
//
// 比较逻辑(ADR-0018 D2):
//   baselineVersion 变 → full(三平台完整包 + app包 + 代码包)
//   depsVersion 变     → app(app包 + 代码包)
//   仅 appVersion 变   → code(仅代码包,日常更新)
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Versions } from './lib/release-versions.js'
import { computeCurrentVersions } from './lib/release-versions.js'

type ReleaseTier = 'code' | 'app' | 'full'

// latest.json 子集(只关心三版本号)
interface PrevManifest {
  appVersion: string
  depsVersion: string
  baselineVersion: string
}

/** 从 GitHub Release assets 下载上一版的 latest.json。 */
function fetchPreviousFromGitHub(repo: string): PrevManifest | null {
  try {
    // gh release view 输出含最新 release 的 tagName
    const stdout = execSync(`gh release view --repo "${repo}" --json tagName,tagName`, {
      encoding: 'utf-8',
      timeout: 15_000,
    })
    const { tagName } = JSON.parse(stdout) as { tagName: string }
    // 从该 release 下载 latest.json(按文件名匹配,不是直接用 tag download)
    const raw = execSync(
      `gh api repos/${repo}/releases/tags/${tagName} --jq '.assets[] | select(.name=="latest.json") | .url'`,
      { encoding: 'utf-8', timeout: 15_000 },
    ).trim()
    if (!raw) return null
    const json = execSync(`gh api ${raw} --jq '.content'`, {
      encoding: 'utf-8',
      timeout: 15_000,
    }).trim()
    // GitHub API base64-encode asset content
    const decoded = Buffer.from(json, 'base64').toString('utf-8')
    return JSON.parse(decoded) as PrevManifest
  } catch {
    return null
  }
}

/** 从本地 release/latest.json 读取。 */
function fetchPreviousFromLocal(repoRoot: string): PrevManifest | null {
  const p = `${repoRoot}/release/latest.json`
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as PrevManifest
  } catch {
    return null
  }
}

/** 获取上一版的 latest.json。先试 GitHub,再回退本地。 */
function fetchPrevious(repo: string, repoRoot: string): PrevManifest | null {
  // GitHub 优先(在线,gh 可用)
  const fromGH = fetchPreviousFromGitHub(repo)
  if (fromGH) return fromGH
  // 回退本地
  return fetchPreviousFromLocal(repoRoot)
}

/** 比较三版本号,决定发版分层。 */
export function determineTier(prev: PrevManifest | null, curr: Versions): ReleaseTier {
  if (!prev) return 'full' // 首次发版

  const changed: string[] = []
  if (prev.baselineVersion !== curr.baselineVersion) changed.push('baselineVersion')
  if (prev.depsVersion !== curr.depsVersion) changed.push('depsVersion')
  if (prev.appVersion !== curr.appVersion) changed.push('appVersion')

  // baseline 变 → 全套
  if (changed.includes('baselineVersion')) return 'full'
  // deps 变 → app 包(含代码包)
  if (changed.includes('depsVersion')) return 'app'
  // 仅 app 变 → 代码包
  if (changed.includes('appVersion')) return 'code'

  // 什么都没变——版本没 bump,不应该走到发版流程,保守给 full
  return 'full'
}

/** 根据 tier 返回 electron-builder 的 target 参数。 */
export function tierTargets(tier: ReleaseTier, _curr: Versions): string {
  switch (tier) {
    case 'full':
      return '--mac --win --linux'
    case 'app':
    case 'code':
      // 只需一个平台产出 unpacked 来抽代码包/app 包,选 linux(CI 最便宜/本地最快)
      return '--linux'
  }
}

function main(): void {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const repo = 'ember-hearted/z-wiki'

  const curr = computeCurrentVersions(repoRoot)
  const prev = fetchPrevious(repo, repoRoot)
  const tier = determineTier(prev, curr)
  const targets = tierTargets(tier, curr)

  // 变了哪些
  const changed: string[] = []
  if (prev) {
    if (prev.baselineVersion !== curr.baselineVersion) changed.push('baselineVersion')
    if (prev.depsVersion !== curr.depsVersion) changed.push('depsVersion')
    if (prev.appVersion !== curr.appVersion) changed.push('appVersion')
  } else {
    changed.push('(首次发版)')
  }

  const result = {
    tier,
    targets,
    versions: curr,
    previous: prev,
    changed,
  }

  // --tier-only: 只输出 tier 字符串(给 shell 变量赋值)
  if (process.argv.includes('--tier-only')) {
    process.stdout.write(`${tier}\n`)
    return
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
