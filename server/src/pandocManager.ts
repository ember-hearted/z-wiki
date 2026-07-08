// pandoc 二进制下载管理(ADR-0007 决策 3)。
// pi 的 ensureTool 硬编码 fd/rg,不能复用,自行实现按平台下载 GitHub release 便携包。
// 开发形态:按需下载到 agentDir/bin;桌面形态:pandoc 已内置(Slice 03),检测存在即跳过。

import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PANDOC_VERSION = '3.10'
const PANDOC_RELEASE_URL = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}`

/** 按 platform/arch 选 pandoc release asset(纯函数,可测)。 */
export function selectPandocAsset(
  platform: string,
  arch: string,
): { asset: string; binary: string } {
  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : 'amd64'
    return { asset: `pandoc-${PANDOC_VERSION}-linux-${a}.tar.gz`, binary: 'pandoc' }
  }
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'arm64' : 'x86_64'
    return { asset: `pandoc-${PANDOC_VERSION}-${a}-macOS.zip`, binary: 'pandoc' }
  }
  if (platform === 'win32') {
    return { asset: `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`, binary: 'pandoc.exe' }
  }
  throw new Error(`不支持的平台:${platform}`)
}

/** pandoc bin 目录(agentDir/bin)。spawnHook 注入此目录到 PATH。 */
export function getPandocBinDir(agentDir: string): string {
  return path.join(agentDir, 'bin')
}

/** pandoc 二进制路径。 */
export function getPandocPath(agentDir: string): string {
  const binary = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc'
  return path.join(getPandocBinDir(agentDir), binary)
}

/**
 * 确保 pandoc 二进制存在(开发形态按需下载)。已存在则跳过;不存在则下载 + 解压到 agentDir/bin。
 * 下载失败抛错(调用方决定是否 warn 不阻塞)。
 */
export async function ensurePandoc(agentDir: string): Promise<string> {
  const pandocPath = getPandocPath(agentDir)
  if (existsSync(pandocPath)) return pandocPath

  const binDir = getPandocBinDir(agentDir)
  await fs.mkdir(binDir, { recursive: true })

  const { asset, binary } = selectPandocAsset(process.platform, process.arch)
  const url = `${PANDOC_RELEASE_URL}/${asset}`
  const archivePath = path.join(binDir, asset)

  // 下载(30s 超时,防网络挂住卡死 server 启动)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`下载 pandoc 失败:${url} HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(archivePath, buf)
  } finally {
    clearTimeout(timeout)
  }

  // 解压(tar -xf 自动识别 tar.gz/zip;现代 GNU tar/bsdtar 均支持)
  const extractDir = path.join(binDir, '_extract')
  await fs.mkdir(extractDir, { recursive: true })
  await execFileAsync('tar', ['-xf', archivePath, '-C', extractDir])

  // 提取 pandoc 二进制到 binDir(解压后在 pandoc-<ver>/bin/pandoc 或顶层)
  const extracted = await findFile(extractDir, binary)
  if (!extracted) throw new Error(`解压后未找到 ${binary}`)
  await fs.rename(extracted, pandocPath)

  // 清理
  await fs.rm(extractDir, { recursive: true, force: true })
  await fs.rm(archivePath, { force: true })
  if (process.platform !== 'win32') {
    await fs.chmod(pandocPath, 0o755)
  }

  return pandocPath
}

/** 递归查找目录下指定文件名。 */
async function findFile(dir: string, name: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name === name) return full
    if (e.isDirectory()) {
      const found = await findFile(full, name)
      if (found) return found
    }
  }
  return null
}
