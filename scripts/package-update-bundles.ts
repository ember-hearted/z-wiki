// package-update-bundles.ts - 打包侧:从 unpacked 抽代码包 + 生成 latest.json(ADR-0018 D2/D3)。
// make package 末尾衔接(electron-builder 打完完整包后)。
// 代码包内容(4 处):app/dist + app/node_modules/@z-wiki/server + web/dist + app/package.json。
// 三版本号:appVersion(desktop/package.json)+ depsVersion(package-lock sha256 前 12 位)+
// baselineVersion(Electron + pandoc/rg/fd 版本组合)。
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** computeVersions 的输入(纯函数,IO 在 main 组装)。 */
export interface VersionInputs {
  appVersion: string
  electronVersion: string
  rg: string
  fd: string
  pandoc: string
  lockHash: string
}

export interface Versions {
  appVersion: string
  depsVersion: string
  baselineVersion: string
}

/** 算三版本号:depsVersion = lockHash 前 12 位,baselineVersion = e{electron}_p{pandoc}_r{rg}_f{fd}。 */
export function computeVersions(input: VersionInputs): Versions {
  return {
    appVersion: input.appVersion,
    depsVersion: input.lockHash.slice(0, 12),
    baselineVersion: `e${input.electronVersion}_p${input.pandoc}_r${input.rg}_f${input.fd}`,
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

/** 生成 latest.json 对象(code 档;app/full 档由 Ticket 05/06 补)。 */
export function buildManifest(versions: Versions, codePackage: LatestPackage): LatestManifest {
  return {
    appVersion: versions.appVersion,
    depsVersion: versions.depsVersion,
    baselineVersion: versions.baselineVersion,
    packages: { code: codePackage },
  }
}

// ===== IO 主流程(make package 调,不单测) =====

/** 算文件 sha512(hex)。 */
function sha512(filePath: string): string {
  return createHash('sha512').update(readFileSync(filePath)).digest('hex')
}

/** 读 desktop/package.json 的 version + electron 版本。 */
function readDesktopPkg(repoRoot: string): { version: string; electron: string } {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'desktop', 'package.json'), 'utf-8'))
  return { version: pkg.version, electron: pkg.devDependencies?.electron ?? '' }
}

/** 读工具二进制版本(desktop/resources/bin/<platformArch>/version.json;任一存在的 platformArch)。 */
function readToolVersions(repoRoot: string): { rg: string; fd: string; pandoc: string } {
  const binRoot = path.join(repoRoot, 'desktop', 'resources', 'bin')
  const dir = existsSync(binRoot)
    ? readdirSync(binRoot).find((d) => existsSync(path.join(binRoot, d, 'version.json')))
    : undefined
  if (!dir) throw new Error('未找到工具版本:请先跑 tsx scripts/fetch-tool-bins.ts')
  return JSON.parse(readFileSync(path.join(binRoot, dir, 'version.json'), 'utf-8'))
}

/** main:从 unpacked 抽代码包 + 生成 latest.json。make package 末尾调。 */
function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const releaseDir = path.join(repoRoot, 'release')
  if (!existsSync(releaseDir)) throw new Error('release/ 不存在:先跑 electron-builder')

  // electron-builder unpacked 目录命名不统一:mac 为 mac/mac-arm64(不带 -unpacked),
  // win/linux 为 win-unpacked/linux-unpacked。按当前平台选(避免抽到 release/ 里旧平台 unpacked)。
  const unpackedName =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'mac-arm64'
        : 'mac'
      : process.platform === 'win32'
        ? process.arch === 'arm64'
          ? 'win-arm64-unpacked'
          : 'win-unpacked'
        : process.arch === 'arm64'
          ? 'linux-arm64-unpacked'
          : 'linux-unpacked'
  const unpackedDir = path.join(releaseDir, unpackedName)
  // mac unpacked 的 resources 在 .app/Contents/Resources/;win/linux 在 unpacked/resources/
  const resourcesDir =
    process.platform === 'darwin'
      ? path.join(unpackedDir, 'z-wiki.app', 'Contents', 'Resources')
      : path.join(unpackedDir, 'resources')
  if (!existsSync(path.join(resourcesDir, 'app'))) {
    throw new Error(`未找到 ${resourcesDir}/app:先跑 electron-builder`)
  }

  const desktop = readDesktopPkg(repoRoot)
  const tools = readToolVersions(repoRoot)
  const lockHash = createHash('sha256')
    .update(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf-8'))
    .digest('hex')
  const versions = computeVersions({
    appVersion: desktop.version,
    electronVersion: desktop.electron,
    rg: tools.rg,
    fd: tools.fd,
    pandoc: tools.pandoc,
    lockHash,
  })

  // 打代码包 tar.gz:从 unpacked resources 抽 4 处(-C resources 切基目录)
  const codeTarball = path.join(releaseDir, `z-wiki-code-${versions.appVersion}.tar.gz`)
  const dests = collectCodePatchEntries(resourcesDir).map((e) => e.dest)
  execSync(`tar -czf '${codeTarball}' -C '${resourcesDir}' ${dests.map((d) => `'${d}'`).join(' ')}`)
  const codePackage: LatestPackage = {
    url: `z-wiki-code-${versions.appVersion}.tar.gz`,
    sha512: sha512(codeTarball),
    size: statSync(codeTarball).size,
  }

  const manifest = buildManifest(versions, codePackage)
  writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  process.stdout.write(
    `代码包: ${path.basename(codeTarball)} (${codePackage.size} bytes)\n` +
      `latest.json: ${path.join(releaseDir, 'latest.json')}\n`,
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
