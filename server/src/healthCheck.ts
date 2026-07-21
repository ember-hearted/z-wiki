// healthCheck.ts - 知识库健康检查:纯函数(供 agentHost 的 health_check 工具调用)。
// 检查项:断链扫描、孤儿 wiki、空文件、重复文件名、frontmatter 覆盖率、wiki 统计。
// 用法:import { runHealthCheck } from './healthCheck.js'  -> runHealthCheck(kbRoot) 返回结构化 HealthReport
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

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
export interface StalePromotion {
  /** wiki 相对路径 */
  wikiRel: string
  /** promoted-to 指向的 stem,但对应 output 不存在 */
  promotedTo: string
}
export interface SuggestedPromotion {
  wikiStem: string
  outputStem: string
  /** wiki 与 output 的 stem 中共有的标记(去前缀后) */
  commonTokens: string[]
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
  stalePromotions: StalePromotion[]
  suggestedPromotions: SuggestedPromotion[]
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

/** 从 frontmatter 中提取字符串字段值。无 frontmatter 或字段不存在返回 null。 */
function fmFieldStr(content: string, field: string): string | null {
  if (!content.startsWith('---')) return null
  const end = content.indexOf('---', 3)
  if (end === -1) return null
  const fm = content.slice(3, end)
  for (const line of fm.split('\n')) {
    const s = line.trim()
    if (s.startsWith(`${field}:`)) {
      const val = s.split(':').slice(1).join(':').trim()
      return val || null
    }
  }
  return null
}

/** 去除 wiki stem 前缀 NN- */
function stripWikiPrefix(stem: string): string {
  return stem.replace(/^\d+-/, '')
}

/** 去除 output stem 前缀 YYYY-MM-DD- */
function stripOutputPrefix(stem: string): string {
  return stem.replace(/^\d{4}-\d{2}-\d{2}-/, '')
}

/** 按 - 分词,去空 */
function tokenize(s: string): string[] {
  return s.split('-').filter(Boolean)
}

/** 找出未设 promoted-to 的 wiki 与 output 间可能的晋升关系。 */
function findSuggestedPromotions(wikiFiles: MdFile[], outputFiles: MdFile[]): SuggestedPromotion[] {
  const results: SuggestedPromotion[] = []
  for (const wiki of wikiFiles) {
    if (fmFieldStr(wiki.content, 'promoted-to')) continue
    const wikiContent = stripWikiPrefix(wiki.stem)
    const wikiTokens = new Set(tokenize(wikiContent))
    let bestMatch: string | null = null
    let bestCommon: string[] = []
    let bestScore = 0
    for (const out of outputFiles) {
      const outContent = stripOutputPrefix(out.stem)
      const common = tokenize(outContent).filter((t) => wikiTokens.has(t))
      // 评分:长 token 权重更高,至少需 1 个 ≥2 字符的 token
      const score = common.reduce((sum, t) => sum + (t.length >= 2 ? t.length : 0), 0)
      if (score > bestScore && score >= 2) {
        bestScore = score
        bestMatch = out.stem
        bestCommon = common
      }
    }
    if (bestMatch) {
      results.push({ wikiStem: wiki.stem, outputStem: bestMatch, commonTokens: bestCommon })
    }
  }
  return results
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
      if (resolved?.stem) referencedStems.add(resolved.stem.toLowerCase())
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

  // 5. promotion 检查
  const outputDir = path.join(kbRoot, 'output')
  const outputFiles = files.filter(
    (f) => f.abs.startsWith(outputDir + path.sep) || f.abs.startsWith(outputDir),
  )
  const outputStems = new Set(outputFiles.map((f) => f.stem))

  // 5a. 过期的 promoted-to:wiki 标了 promoted-to 但 output 已不存在
  const stalePromotions: StalePromotion[] = []
  for (const w of wikiFiles) {
    const pt = fmFieldStr(w.content, 'promoted-to')
    if (pt && !outputStems.has(pt)) {
      stalePromotions.push({ wikiRel: w.rel, promotedTo: pt })
    }
  }

  // 5b. 建议补 promoted-to:未标的 wiki 与 output 之间根据 stem 相似度推断
  const suggestedPromotions = findSuggestedPromotions(wikiFiles, outputFiles)
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
    stalePromotions,
    suggestedPromotions,
    frontmatterPct,
    wikiStats,
  }
}

/** runHealthCheck 是 collectReport 的语义别名(供 agentHost 调用,语义=只读扫描)。 */
export const runHealthCheck = collectReport
