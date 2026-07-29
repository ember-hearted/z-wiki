// package-update-bundles.ts - 打包侧:从 unpacked 抽代码包 + 生成 latest.json(ADR-0018 D2/D3)。
// make package 末尾衔接(electron-builder 打完完整包后)。
// 代码包内容(4 处):app/dist + app/node_modules/@z-wiki/server + web/dist + app/package.json。
// 三版本号:appVersion(desktop/package.json)+ depsVersion(package-lock sha256 前 12 位)+
// baselineVersion(Electron + pandoc/rg/fd 版本组合)。

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Versions } from './lib/release-versions.js'
import {
  computeVersions,
  readDesktopPkg,
  readLockHash,
  readToolVersions,
} from './lib/release-versions.js'

/** latest.json 单个包条目(结构对应 desktop/src/updater.ts 的 PackageInfo)。 */
export interface LatestPackage {
  url: string
  sha512: string
  size: number
}

/** latest.json(ADR-0018 决策 3;结构对应 desktop/src/updater.ts 的 RemoteManifest)。 */
export interface LatestManifest {
  appVersion: string
  depsVersion: string
  baselineVersion: string
  packages: {
    code?: LatestPackage
    app?: LatestPackage
    full?: Record<string, LatestPackage>
  }
}

/** 代码包要打进 tar 的路径(src=unpacked 内绝对,dest=tar 内相对)。 */
export interface PatchEntry {
  src: string
  dest: string
}

export function collectCodePatchEntries(unpackedResourcesDir: string): PatchEntry[] {
  return [
    { src: path.join(unpackedResourcesDir, 'app', 'dist'), dest: 'app/dist' },
    {
      src: path.join(unpackedResourcesDir, 'app', 'node_modules', '@z-wiki', 'server'),
      dest: 'app/node_modules/@z-wiki/server',
    },
    { src: path.join(unpackedResourcesDir, 'web', 'dist'), dest: 'web/dist' },
    { src: path.join(unpackedResourcesDir, 'app', 'package.json'), dest: 'app/package.json' },
  ]
}

/** 应用包要打进 tar 的路径:整个 app/ + web/dist/(含 node_modules,跨平台)。 */
export function collectAppBundleEntries(unpackedResourcesDir: string): PatchEntry[] {
  return [
    { src: path.join(unpackedResourcesDir, 'app'), dest: 'app' },
    { src: path.join(unpackedResourcesDir, 'web', 'dist'), dest: 'web/dist' },
  ]
}

/** 生成 latest.json 对象(code 档 + app 档 + full 档按平台 map)。 */
export function buildManifest(
  versions: Versions,
  codePackage: LatestPackage,
  appPackage?: LatestPackage,
  fullPackages?: Record<string, LatestPackage>,
): LatestManifest {
  return {
    appVersion: versions.appVersion,
    depsVersion: versions.depsVersion,
    baselineVersion: versions.baselineVersion,
    packages: { code: codePackage, app: appPackage, full: fullPackages },
  }
}

/** 完整包命名(ADR-0018 D4):z-wiki-{version}-{os}-{arch}.{dmg|exe|AppImage}。zip 便携不进自动更新(PRD Out of Scope)。 */
const FULL_PACKAGE_RE = /^z-wiki-(.+)-(mac|win|linux)-(x64|arm64)\.(dmg|exe|AppImage)$/

/**
 * 扫 releaseDir 收当前版本的完整包 -> full map(键 mac-arm64/win-x64/linux-x64,对应
 * updater.ts 的 fullPackageKey)。只收 version 匹配的新命名文件:旧命名(z-wiki-0.1.0.dmg)、
 * zip 便携、blockmap、其他版本自动排除。
 */
export function collectFullPackages(
  releaseDir: string,
  version: string,
): Record<string, LatestPackage> {
  const packages: Record<string, LatestPackage> = {}
  if (!existsSync(releaseDir)) return packages
  for (const file of readdirSync(releaseDir)) {
    const m = FULL_PACKAGE_RE.exec(file)
    if (!m || m[1] !== version) continue
    const filePath = path.join(releaseDir, file)
    if (!statSync(filePath).isFile()) continue
    packages[`${m[2]}-${m[3]}`] = {
      url: file,
      sha512: sha512(filePath),
      size: statSync(filePath).size,
    }
  }
  return packages
}

// ===== IO 主流程(make package 调,不单测) =====

/** 算文件 sha512(hex)。 */
function sha512(filePath: string): string {
  return createHash('sha512').update(readFileSync(filePath)).digest('hex')
}

/** unpacked 候选目录:mac 为 mac-arm64/mac(不带 -unpacked),win/linux 为 *-unpacked。 */
const UNPACKED_CANDIDATES = [
  { dir: 'mac-arm64', resources: path.join('z-wiki.app', 'Contents', 'Resources') },
  { dir: 'mac', resources: path.join('z-wiki.app', 'Contents', 'Resources') },
  { dir: 'win-unpacked', resources: 'resources' },
  { dir: 'win-arm64-unpacked', resources: 'resources' },
  { dir: 'linux-unpacked', resources: 'resources' },
  { dir: 'linux-arm64-unpacked', resources: 'resources' },
]

/**
 * 按 mtime 选最新 unpacked 的 resources 目录(= 本次 electron-builder 的输出)。
 * 不按当前平台选:AUTO 增量打包只打 linux,当前平台的 unpacked 可能是上次全量的
 * 旧残留(v0.5.0 发版时 mac-arm64 旧件被抽进 code/app 包,发出 0.4.2 内容标 0.5.0)。
 */
export function pickLatestUnpacked(releaseDir: string): string {
  let best: { resourcesDir: string; mtimeMs: number } | null = null
  for (const c of UNPACKED_CANDIDATES) {
    const resourcesDir = path.join(releaseDir, c.dir, c.resources)
    if (!existsSync(path.join(resourcesDir, 'app'))) continue
    const mtimeMs = statSync(resourcesDir).mtimeMs
    if (!best || mtimeMs > best.mtimeMs) best = { resourcesDir, mtimeMs }
  }
  if (!best) throw new Error(`未找到任何 unpacked 产物(${releaseDir}):先跑 electron-builder`)
  return best.resourcesDir
}

/** main:从 unpacked 抽代码包 + 生成 latest.json。make package 末尾调。 */
function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const releaseDir = path.join(repoRoot, 'release')
  if (!existsSync(releaseDir)) throw new Error('release/ 不存在:先跑 electron-builder')

  const resourcesDir = pickLatestUnpacked(releaseDir)
  console.log(`unpacked 源: ${path.relative(repoRoot, resourcesDir)}`)

  const desktop = readDesktopPkg(repoRoot)
  const tools = readToolVersions(repoRoot)
  const lockHash = readLockHash(repoRoot)
  const versions = computeVersions({
    appVersion: desktop.version,
    electronVersion: desktop.electron,
    rg: tools.rg,
    fd: tools.fd,
    pandoc: tools.pandoc,
    lockHash,
  })

  // 代码包:4 处项目代码(跨平台,~5M)
  const codeTarball = path.join(releaseDir, `z-wiki-code-${versions.appVersion}.tar.gz`)
  const codeDests = collectCodePatchEntries(resourcesDir).map((e) => e.dest)
  execSync(
    `tar -czf '${codeTarball}' -C '${resourcesDir}' ${codeDests.map((d) => `'${d}'`).join(' ')}`,
  )
  const codePackage: LatestPackage = {
    url: `z-wiki-code-${versions.appVersion}.tar.gz`,
    sha512: sha512(codeTarball),
    size: statSync(codeTarball).size,
  }

  // 应用包:整个 app/ + web/dist/(跨平台,~45M;depsVersion 变时下,整体替换 app/)
  const appTarball = path.join(releaseDir, `z-wiki-app-${versions.appVersion}.tar.gz`)
  const appDests = collectAppBundleEntries(resourcesDir).map((e) => e.dest)
  execSync(
    `tar -czf '${appTarball}' -C '${resourcesDir}' ${appDests.map((d) => `'${d}'`).join(' ')}`,
  )
  const appPackage: LatestPackage = {
    url: `z-wiki-app-${versions.appVersion}.tar.gz`,
    sha512: sha512(appTarball),
    size: statSync(appTarball).size,
  }

  const fullPackages = collectFullPackages(releaseDir, versions.appVersion)
  const manifest = buildManifest(versions, codePackage, appPackage, fullPackages)
  writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  process.stdout.write(
    `代码包: ${path.basename(codeTarball)} (${codePackage.size} bytes)\n` +
      `应用包: ${path.basename(appTarball)} (${appPackage.size} bytes)\n` +
      `完整包: ${Object.keys(fullPackages).sort().join(', ') || '(无)'}\n` +
      `latest.json: ${path.join(releaseDir, 'latest.json')}\n`,
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
