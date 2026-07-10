// healthCheck.ts - 知识库健康检查:纯函数(供 agentHost 的 health_check 工具调用)+ CLI entry(make health)。
// 检查项:断链扫描、孤儿 wiki、空文件、重复文件名、frontmatter 覆盖率、wiki 统计。
// 用法:
//   - 库:import { runHealthCheck } from './healthCheck.js'  -> runHealthCheck(kbRoot) 返回结构化 HealthReport
//   - CLI:npm run health(tsx server/src/healthCheck.ts)-> 写 kb/health-check/YYYY-MM-DD-报告.md
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  '.claude',
  '.firecrawl',
  '.playwright-mcp',
  '__pycache__',
  'node_modules',
  'dist',
  '.pi',
])
const NON_MD_EXT = new Set([
  '.srt',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.csv',
  '.json',
  '.svg',
  '.avif',
])
const PLACEHOLDER_PATTERNS = [
  /^\.\.\.$/,
  /^raw\/\.\.\.$/,
  /^NN-/,
  /^wikilink$/,
  /^<.*>$/,
  /\.\.\./,
  /^\$/,
  /^\d+,\s*\d+/,
  /\.\w+\.\w+/,
  /"/,
]

interface MdFile {
  abs: string
  rel: string
  stem: string
  content: string
}

export interface BrokenLink {
  from: string
  target: string
}
export interface OrphanPage {
  rel: string
  stem: string
}
export interface EmptyFile {
  rel: string
}
export interface DupFile {
  stem: string
  paths: string[]
}
export interface WikiStat {
  stem: string
  lines: number
  hasFrontmatter: boolean
}
export interface HealthReport {
  fileCount: number
  wikiCount: number
  broken: BrokenLink[]
  orphans: OrphanPage[]
  empties: EmptyFile[]
  dups: DupFile[]
  frontmatterPct: number
  wikiStats: WikiStat[]
}

async function gatherMdFiles(kbRoot: string): Promise<MdFile[]> {
  const out: MdFile[] = []
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || e.name.startsWith('_')) continue
        await walk(full)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const content = await fs.readFile(full, 'utf-8')
        out.push({
          abs: full,
          rel: path.relative(kbRoot, full),
          stem: e.name.replace(/\.md$/, ''),
          content,
        })
      }
    }
  }
  await walk(kbRoot)
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

function isPlaceholder(target: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(target))
}

function extractWikilinks(text: string): string[] {
  // 去代码块与行内代码
  const noFence = text.replace(/```[\s\S]*?```/g, '')
  const noInline = noFence.replace(/`[^`]+`/g, '')
  const links: string[] = []
  for (const m of noInline.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const raw = m[1].trim()
    if (!raw) continue
    const target = raw.split('|')[0].replace(/\\+$/, '').trim()
    if (!target || isPlaceholder(target)) continue
    links.push(target)
  }
  return links
}

function resolveWikilink(target: string, files: MdFile[], kbRoot: string): MdFile | null {
  const ext = path.extname(target).toLowerCase()
  if (ext && NON_MD_EXT.has(ext)) return null
  // raw/ 引用:只检查 raw 下是否存在(原文,不强求 .md)
  if (target.startsWith('raw/') || target.startsWith('./raw/')) {
    const p = path.join(kbRoot, target.replace(/^\.\//, ''))
    return existsSync(p) ? { abs: p, rel: target, stem: '', content: '' } : null
  }
  // stem 精确匹配(大小写不敏感)
  const targetStem = path.basename(target).replace(/\.md$/i, '').toLowerCase()
  const matches = files.filter((f) => f.stem.toLowerCase() === targetStem)
  return matches.length === 1 ? matches[0] : matches.length > 1 ? matches[0] : null
}

function hasFrontmatter(content: string): boolean {
  return content.startsWith('---')
}

function isEmptyOrOnlyFrontmatter(content: string): boolean {
  if (!content.trim()) return true
  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3)
    if (end === -1) return false
    return content.slice(end + 3).trim().length === 0
  }
  return false
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 收集知识库健康检查结果(纯函数,只读扫 kb/,不写盘不 console)。
 * 供 agentHost 的 health_check 工具调用(ADR-0009)。
 */
export async function collectReport(kbRoot: string): Promise<HealthReport> {
  const files = await gatherMdFiles(kbRoot)
  const wikiDir = path.join(kbRoot, 'wiki')
  const wikiFiles = files.filter(
    (f) => f.abs.startsWith(wikiDir + path.sep) || f.abs.startsWith(wikiDir),
  )

  // 1. 断链扫描
  const broken: BrokenLink[] = []
  for (const f of files) {
    for (const target of extractWikilinks(f.content)) {
      if (!resolveWikilink(target, files, kbRoot)) {
        broken.push({ from: f.rel, target })
      }
    }
  }

  // 2. 孤儿 wiki(未被任何其他 .md 引用)
  const referencedStems = new Set<string>()
  for (const f of files) {
    for (const target of extractWikilinks(f.content)) {
      const resolved = resolveWikilink(target, files, kbRoot)
      if (resolved && resolved.stem) referencedStems.add(resolved.stem.toLowerCase())
    }
  }
  const orphans: OrphanPage[] = wikiFiles
    .filter((w) => !referencedStems.has(w.stem.toLowerCase()) && w.stem !== '00-知识库导航')
    .map((w) => ({ rel: w.rel, stem: w.stem }))

  // 3. 空文件
  const empties: EmptyFile[] = files
    .filter((f) => isEmptyOrOnlyFrontmatter(f.content))
    .map((f) => ({ rel: f.rel }))

  // 4. 重复文件名
  const nameCount = new Map<string, string[]>()
  for (const f of files) {
    const arr = nameCount.get(f.stem) ?? []
    arr.push(f.rel)
    nameCount.set(f.stem, arr)
  }
  const dups: DupFile[] = [...nameCount.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([stem, paths]) => ({ stem, paths }))

  // 5. frontmatter 覆盖率
  const withFm = files.filter((f) => hasFrontmatter(f.content)).length
  const frontmatterPct = files.length ? Math.round((withFm / files.length) * 100) : 0

  // 6. wiki 统计
  const wikiStats: WikiStat[] = wikiFiles.map((w) => ({
    stem: w.stem,
    lines: w.content.split('\n').length,
    hasFrontmatter: hasFrontmatter(w.content),
  }))

  return {
    fileCount: files.length,
    wikiCount: wikiFiles.length,
    broken,
    orphans,
    empties,
    dups,
    frontmatterPct,
    wikiStats,
  }
}

/** runHealthCheck 是 collectReport 的语义别名(供 agentHost 调用,语义=只读扫描)。 */
export const runHealthCheck = collectReport

/**
 * 把 HealthReport 格式化成 markdown 报告字符串(纯函数,不写盘)。
 * CLI entry(make health)用它生成报告文件。
 */
export function formatReport(report: HealthReport, dateStr: string = today()): string {
  const lines: string[] = []
  lines.push(`---`)
  lines.push(`tags: [健康检查]`)
  lines.push(`updated: ${dateStr}`)
  lines.push(`status: active`)
  lines.push(`view: false`)
  lines.push(`---`)
  lines.push(``)
  lines.push(`# 知识库健康检查 ${dateStr}`)
  lines.push(``)
  lines.push(`> 共 ${report.fileCount} 个 .md 文件,wiki/ ${report.wikiCount} 个。`)
  lines.push(``)
  lines.push(`## 检查项概览`)
  lines.push(``)
  lines.push(`| 检查项 | 状态 | 详情 |`)
  lines.push(`|------|------|------|`)
  lines.push(
    `| 断链扫描 | ${report.broken.length === 0 ? '✅ 无断链' : `⚠️ ${report.broken.length} 条`} | ${report.broken.length ? '见下表' : '-'} |`,
  )
  lines.push(
    `| 孤儿 wiki | ${report.orphans.length === 0 ? '✅ 无孤儿' : `⚠️ ${report.orphans.length} 篇`} | ${report.orphans.length ? report.orphans.map((o) => o.stem).join(', ') : '-'} |`,
  )
  lines.push(
    `| 空文件 | ${report.empties.length === 0 ? '✅ 无' : `⚠️ ${report.empties.length} 个`} | ${report.empties.length ? report.empties.map((e) => e.rel).join(', ') : '-'} |`,
  )
  lines.push(
    `| 重复文件名 | ${report.dups.length === 0 ? '✅ 无' : `⚠️ ${report.dups.length} 组`} | ${report.dups.length ? report.dups.map((d) => `${d.stem}(${d.paths.length})`).join(', ') : '-'} |`,
  )
  lines.push(
    `| Frontmatter 覆盖率 | ${report.frontmatterPct >= 80 ? '✅' : '⚠️'} ${report.frontmatterPct}% | ${report.fileCount ? Math.round((report.frontmatterPct / 100) * report.fileCount) : 0}/${report.fileCount} |`,
  )
  lines.push(`| Wiki 统计 | ℹ️ ${report.wikiCount} 篇 | 见下表 |`)
  lines.push(``)
  lines.push(`## 断链详情`)
  lines.push(``)
  if (report.broken.length === 0) {
    lines.push(`无断链。`)
  } else {
    lines.push(`| 来源 | 目标 |`)
    lines.push(`|------|------|`)
    for (const b of report.broken) lines.push(`| ${b.from} | ${b.target} |`)
  }
  lines.push(``)
  lines.push(`## 孤儿 wiki`)
  lines.push(``)
  if (report.orphans.length === 0) {
    lines.push(`无孤儿页面。`)
  } else {
    for (const o of report.orphans) lines.push(`- [[${o.stem}]]`)
  }
  lines.push(``)
  lines.push(`## Wiki 文件统计`)
  lines.push(``)
  lines.push(`| 文件 | 行数 | frontmatter |`)
  lines.push(`|------|------:|:---:|`)
  for (const w of report.wikiStats) {
    lines.push(`| [[${w.stem}]] | ${w.lines} | ${w.hasFrontmatter ? '✅' : '-'} |`)
  }
  return lines.join('\n')
}

/** CLI entry:扫项目根 kb/(process.cwd()/kb),写报告到 kb/health-check/。仅直接运行时执行。 */
async function main(): Promise<void> {
  const kbRoot = path.resolve(process.cwd(), 'kb')
  if (!existsSync(kbRoot)) {
    console.error(`知识库目录不存在:${kbRoot}`)
    process.exit(1)
  }
  const report = await collectReport(kbRoot)
  const md = formatReport(report)
  const reportDir = path.join(kbRoot, 'health-check')
  await fs.mkdir(reportDir, { recursive: true })
  const reportPath = path.join(reportDir, `${today()}-知识库健康检查-报告.md`)
  await fs.writeFile(reportPath, md, 'utf-8')

  console.log(`知识库健康检查完成 -> ${path.relative(kbRoot, reportPath)}`)
  console.log(`  .md 文件: ${report.fileCount}  wiki: ${report.wikiCount}`)
  console.log(
    `  断链: ${report.broken.length}  孤儿: ${report.orphans.length}  空文件: ${report.empties.length}  重复: ${report.dups.length}  frontmatter: ${report.frontmatterPct}%`,
  )
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    console.error('健康检查失败:', err)
    process.exit(1)
  })
}
