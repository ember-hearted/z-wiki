// buildView.ts — 知识库 → 可视数据 的纯函数编译器。
// 扫描 wiki/(除导航页 00-知识库导航,ADR-0010)与 output/ 的 .md,编译为内存结构:
//   pages     — PageMeta[] 索引(供前端列表/导航)
//   fragments — Map<stem, html> 文章片段(<article class="prose">...)
// 纯函数:只读文件系统,不写盘。由 Interaction 缓存结果并经 HTTP 暴露。
// md→html 1:1 平移自原 Python 版。
import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { wikiDir, outputDir } from './kbLayout.js'
import { mdToHtml, splitFrontmatter } from './markdown.js'

export interface TocItem {
  level: 'h2' | 'h3'
  text: string
}

export interface PageMeta {
  stem: string
  title: string
  summary: string
  updated: string
  toc: TocItem[]
  type: 'wiki' | 'output'
}

export interface BuildResult {
  pages: PageMeta[]
  fragments: Map<string, string>
}

const DEFAULT_MIN_LINES = 30
const SKIP_TOC = new Set(['来源', '相关主题', '参考', '参考文档'])

function fmField(fm: string, field: string): boolean | null {
  for (const line of fm.split('\n')) {
    const s = line.trim()
    if (s.startsWith(`${field}:`)) {
      const val = s.split(':').slice(1).join(':').trim().toLowerCase()
      return val === 'true' || val === 'yes' || val === '1'
    }
  }
  return null
}

// ── 元信息提取 ───────────────────────────────────────────────
function extractTitle(text: string): string | null {
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (s.startsWith('# ') && !s.startsWith('## ')) return s.slice(2).trim()
  }
  return null
}

function buildToc(mdText: string): TocItem[] {
  const { body } = splitFrontmatter(mdText)
  const toc: TocItem[] = []
  for (const line of body.split('\n')) {
    const s = line.trim()
    let text = ''
    let level: 'h2' | 'h3' | null = null
    if (s.startsWith('## ') && !s.startsWith('### ')) {
      level = 'h2'
      text = s.slice(3).trim()
    } else if (s.startsWith('### ') && !s.startsWith('#### ')) {
      level = 'h3'
      text = s.slice(4).trim()
    }
    if (level && text) {
      const clean = text.replace(/\*\*(.+?)\*\*/g, '$1')
      if (!SKIP_TOC.has(clean)) toc.push({ level, text: clean })
    }
  }
  return toc
}

function extractSummary(mdText: string): string {
  const { body } = splitFrontmatter(mdText)
  for (const line of body.split('\n')) {
    const s = line.trim()
    if (!s) continue
    if (s.startsWith('#') || s.startsWith('>') || s.startsWith('```') || s.startsWith('|')) continue
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) continue
    if (/^[-*+]\s/.test(s) || /^\d+\.\s/.test(s)) continue
    const clean = s.replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/g, '$1')
    return clean.slice(0, 120)
  }
  return ''
}

// ── 文件扫描 ─────────────────────────────────────────────────
interface Source {
  abs: string
  rel: string
  stem: string
  type: 'wiki' | 'output'
}

function shouldPublish(src: Source, mdText: string, minLines: number): boolean {
  if (src.type === 'wiki') {
    // wiki 全显,仅排除导航页 00-知识库导航(ADR-0010,hardcode stem,与 healthCheck 一致)
    return src.stem !== '00-知识库导航'
  }
  // output: publish 标记优先,否则按行数
  const { fm } = splitFrontmatter(mdText)
  const pub = fmField(fm, 'publish')
  if (pub !== null) return pub
  const lineCount = mdText.trim() ? mdText.trim().split('\n').length : 0
  return lineCount >= minLines
}

async function scanSources(kbRoot: string): Promise<Source[]> {
  const wiki = wikiDir(kbRoot)
  const output = outputDir(kbRoot)
  const sources: Source[] = []
  for (const [dir, type] of [
    [wiki, 'wiki'],
    [output, 'output'],
  ] as const) {
    if (!existsSync(dir)) continue
    const files = await fs.readdir(dir)
    for (const f of files.sort()) {
      if (!f.endsWith('.md')) continue
      const abs = path.join(dir, f)
      sources.push({
        abs,
        rel: path.relative(kbRoot, abs),
        stem: f.replace(/\.md$/, ''),
        type,
      })
    }
  }
  return sources
}

// ── 主构建 ───────────────────────────────────────────────────
export async function buildView(kbRoot: string): Promise<BuildResult> {
  const sources = await scanSources(kbRoot)
  const minLines = DEFAULT_MIN_LINES
  const publishable: Source[] = []
  for (const src of sources) {
    const mdText = await fs.readFile(src.abs, 'utf-8')
    if (shouldPublish(src, mdText, minLines)) publishable.push(src)
  }

  const pages: PageMeta[] = []
  const fragments = new Map<string, string>()
  for (const src of publishable) {
    const mdText = await fs.readFile(src.abs, 'utf-8')
    const stat = await fs.stat(src.abs)
    const title = extractTitle(mdText) ?? src.stem
    fragments.set(src.stem, `<article class="prose">\n${mdToHtml(mdText)}\n</article>`)
    pages.push({
      stem: src.stem,
      title,
      summary: extractSummary(mdText),
      updated: stat.mtime.toISOString().slice(0, 10),
      toc: buildToc(mdText),
      type: src.type,
    })
  }

  return { pages, fragments }
}
