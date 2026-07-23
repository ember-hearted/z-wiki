// fetch-tool-bins.ts - 开发期脚本:从 GitHub releases 下载 rg/fd/pandoc 二进制,
// 解压提取,放进 desktop/resources/bin/<platform>-<arch>/(ADR-0003 D8 bundle 模板 +
// ADR-0007 决策 3 pandoc 桌面内置)。
// 桌面 app 首次启动从此目录复制到 UserDataDir/.pi/agent/bin/。
//
// 用法:tsx scripts/fetch-tool-bins.ts [--platform <p>] [--arch <a>] [--all]
//   默认下载当前平台;--all 下载全部六套(darwin/linux/win32 × arm64/x64),切片 06 打包用。
// 二进制大,desktop/resources/bin/ 已 .gitignore,clone 后跑此脚本拉取。
import { execSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import process from 'node:process'

// 版本号(可按需升级;改后首次启动会因 version.json 不一致而重新铺放)。
const RG_VERSION = '14.1.1'
const FD_VERSION = '10.1.0'
// pandoc 版本:需与 server/src/pandocManager.ts 的 PANDOC_VERSION 保持一致(开发形态下载同版本)。
const PANDOC_VERSION = '3.10'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const OUT_ROOT = path.join(REPO_ROOT, 'desktop', 'resources', 'bin')

interface ToolSpec {
  tool: 'rg' | 'fd' | 'pandoc'
  repo: string
  version: string
  // tagPrefix: rg 无 v 前缀,fd 有 v 前缀(与 pi tools-manager 一致),pandoc 无 v 前缀。
  tagPrefix: string
  assetName: (plat: string, arch: string) => string | null
  // 解压后二进制在 archive 内的相对路径(用于提取)。
  binaryInArchive: (plat: string) => string
}

const TOOLS: ToolSpec[] = [
  {
    tool: 'rg',
    repo: 'BurntSushi/ripgrep',
    version: RG_VERSION,
    tagPrefix: '',
    assetName: (plat, arch) => {
      const a = arch === 'arm64' ? 'aarch64' : 'x86_64'
      if (plat === 'darwin') return `ripgrep-${RG_VERSION}-${a}-apple-darwin.tar.gz`
      if (plat === 'linux') {
        return arch === 'arm64'
          ? `ripgrep-${RG_VERSION}-aarch64-unknown-linux-gnu.tar.gz`
          : `ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz`
      }
      if (plat === 'win32') {
        // ripgrep 不发 aarch64-pc-windows-msvc;arm64 走 x86_64 仿真(与 pandoc 一致)
        return `ripgrep-${RG_VERSION}-x86_64-pc-windows-msvc.zip`
      }
      return null
    },
    binaryInArchive: (plat) => (plat === 'win32' ? 'rg.exe' : 'rg'),
  },
  {
    tool: 'fd',
    repo: 'sharkdp/fd',
    version: FD_VERSION,
    tagPrefix: 'v',
    assetName: (plat, arch) => {
      const a = arch === 'arm64' ? 'aarch64' : 'x86_64'
      if (plat === 'darwin') return `fd-v${FD_VERSION}-${a}-apple-darwin.tar.gz`
      if (plat === 'linux') return `fd-v${FD_VERSION}-${a}-unknown-linux-gnu.tar.gz`
      if (plat === 'win32') {
        // fd 不发 aarch64-pc-windows-msvc;arm64 走 x86_64 仿真(与 pandoc 一致)
        return `fd-v${FD_VERSION}-x86_64-pc-windows-msvc.zip`
      }
      return null
    },
    binaryInArchive: (plat) => (plat === 'win32' ? 'fd.exe' : 'fd'),
  },
  {
    tool: 'pandoc',
    repo: 'jgm/pandoc',
    version: PANDOC_VERSION,
    tagPrefix: '',
    assetName: (plat, arch) => {
      if (plat === 'linux') {
        const a = arch === 'arm64' ? 'arm64' : 'amd64'
        return `pandoc-${PANDOC_VERSION}-linux-${a}.tar.gz`
      }
      if (plat === 'darwin') {
        const a = arch === 'arm64' ? 'arm64' : 'x86_64'
        return `pandoc-${PANDOC_VERSION}-${a}-macOS.zip`
      }
      // pandoc 官方只发 windows-x86_64;arm64 windows 走 x86_64 emulation。
      if (plat === 'win32') return `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`
      return null
    },
    binaryInArchive: (plat) => (plat === 'win32' ? 'pandoc.exe' : 'pandoc'),
  },
]

const PLATFORM_ARCHS: Array<[string, string]> = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
  ['win32', 'arm64'],
  ['win32', 'x64'],
]

function parseArgs(): { targets: Array<[string, string]> } {
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const platIdx = args.indexOf('--platform')
  const archIdx = args.indexOf('--arch')
  if (all) return { targets: PLATFORM_ARCHS }
  const plat = platIdx >= 0 ? args[platIdx + 1] : process.platform
  const arch = archIdx >= 0 ? args[archIdx + 1] : process.arch
  return { targets: [[plat, arch]] }
}

async function download(url: string, dest: string): Promise<void> {
  process.stdout.write(`  下载 ${url}\n`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status}: ${url}`)
  // pipeline 正确等待流完成(pipe(ws) 返回的流不等 finish,会导致文件未写完就解压)。
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

// 按压缩包扩展名选解压工具(宿主适配,非目标平台):切片 06 跨平台打包需在 mac 宿主上
// 解 win/linux 的 .zip/.tar.gz。原实现按目标 plat 选 powershell/tar,mac 上解 win zip 失败。
// mac bsdtar 的 `tar -xf` 自动识别格式(tar.gz + zip 均可);linux GNU tar 不解 zip,回落 unzip。
function extractArchive(archive: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  if (archive.endsWith('.zip')) {
    try {
      execSync(`tar -xf '${archive}' -C '${dest}'`)
    } catch {
      execSync(`unzip -o '${archive}' -d '${dest}'`)
    }
  } else {
    execSync(`tar -xzf '${archive}' -C '${dest}'`)
  }
}

function findBinary(root: string, name: string): string {
  // archive 解压后二进制在子目录(如 ripgrep-14.1.1-aarch64-apple-darwin/rg)。
  // 用 Node fs 递归查找,不依赖 shell find(win 无 find 命令)。
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      const stat = statSync(full)
      if (stat.isFile() && entry === name) return full
      if (stat.isDirectory()) stack.push(full)
    }
  }
  throw new Error(`解压后未找到 ${name} in ${root}`)
}

async function fetchOne(plat: string, arch: string): Promise<void> {
  const outDir = path.join(OUT_ROOT, `${plat}-${arch}`)
  mkdirSync(outDir, { recursive: true })
  process.stdout.write(`== ${plat}-${arch} -> ${outDir}\n`)
  for (const spec of TOOLS) {
    const asset = spec.assetName(plat, arch)
    if (!asset) {
      process.stdout.write(`  跳过 ${spec.tool}:不支持的平台 ${plat}-${arch}\n`)
      continue
    }
    const url = `https://github.com/${spec.repo}/releases/download/${spec.tagPrefix}${spec.version}/${asset}`
    const archive = path.join(tmpdir(), asset)
    await download(url, archive)
    const extractDir = path.join(tmpdir(), `zwiki-fetch-${spec.tool}-${plat}-${arch}`)
    rmSync(extractDir, { recursive: true, force: true })
    extractArchive(archive, extractDir)
    const binSrc = findBinary(extractDir, spec.binaryInArchive(plat))
    const binDest = path.join(outDir, spec.binaryInArchive(plat))
    execSync(`cp '${binSrc}' '${binDest}'`)
    if (plat !== 'win32') execSync(`chmod 755 '${binDest}'`)
    rmSync(extractDir, { recursive: true, force: true })
    rmSync(archive, { force: true })
    process.stdout.write(`  ${spec.tool} ${spec.version} ✓\n`)
  }
  writeFileSync(
    path.join(outDir, 'version.json'),
    JSON.stringify({ rg: RG_VERSION, fd: FD_VERSION, pandoc: PANDOC_VERSION }, null, 2),
    'utf-8',
  )
}

async function main(): Promise<void> {
  const { targets } = parseArgs()
  for (const [plat, arch] of targets) {
    await fetchOne(plat, arch)
  }
  process.stdout.write(`\n完成。二进制在 ${OUT_ROOT}/<platform>-<arch>/,已 .gitignore。\n`)
}

void main().catch((err) => {
  console.error('fetch-tool-bins 失败:', err)
  process.exit(1)
})
