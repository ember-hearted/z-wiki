// markdown.ts - md -> html 纯函数渲染器(行内 + 块级,1:1 平移自原 Python 版)。
// 从 buildView.ts 抽离以便前后端共用:server 编译 wiki 文章片段,web 渲染 chat 回复。
// 零依赖(纯字符串操作),浏览器端可安全 import。文本经 escapeHtml 转义,XSS 安全。

/** 分离 frontmatter:首行 `---` 起到下一个 `---` 为 fm,其余为 body。无 frontmatter 返回原文。 */
export function splitFrontmatter(text: string): { body: string; fm: string } {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { body: text, fm: '' }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { body: lines.slice(i + 1).join('\n'), fm: lines.slice(1, i).join('\n') }
    }
  }
  return { body: text, fm: '' }
}

function escapeHtml(s: string): string {
  // 引号也要转义:escapeHtml 的产出会进属性值(data-lang/src/href),不转义 " 可突破属性注入事件属性(XSS)。
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseInline(text: string): string {
  let t = escapeHtml(text)
  // 图片/wikilink/链接先生成 HTML,但 src/href/alt 里的 _ * 会被下方斜体/加粗正则跨标签
  // 配对污染(如 ![01_tk.md](url) 的 alt 与 src 的 _ 配对,把 <em> 注入 src,破坏 URL)。
  // 故先 stash 成占位符,跑完行内格式再换回,属性值不参与 _ * 配对。
  const stash: string[] = []
  const place = (html: string): string => {
    stash.push(html)
    return `\u0000${stash.length - 1}\u0000`
  }
  // 图片 ![alt](url)。alt 排除 [(防 ![+长串[ 回溯);url 排除圆括号(防 ![]( 重复串多项式回溯,
  // CodeQL js/polynomial-redos;含括号 URL 用旧正则本就截断在首个 ),不匹配渲染为纯文本更直观)。
  t = t.replace(/!\[([^[\]]*)\]\(([^()]+)\)/g, (_m, alt, url) =>
    place(`<img src="${url}" alt="${alt}" />`),
  )
  // wikilink [[a|b]] / [[a]]
  const wikilink = (p: string, label: string): string => {
    if (p.startsWith('raw/') || p.startsWith('./raw/')) return place(label)
    return place(`<a href="/pages/${p}" class="wl">${label}</a>`)
  }
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, p, lbl) => wikilink(p, lbl))
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, p) => wikilink(p, p))
  // 链接 [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, url) => place(`<a href="${url}">${txt}</a>`))
  // 加粗 / 斜体 / 行内代码 / 删除线
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/__(.+?)__/g, '<strong>$1</strong>')
  t = t.replace(/\*(.+?)\*/g, '<em>$1</em>')
  t = t.replace(/_(.+?)_/g, '<em>$1</em>')
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/~~(.+?)~~/g, '<del>$1</del>')
  // 换回占位符(属性值原样,未被 _ * 污染)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NULL 字符作 stash 占位符分隔符,故意使用(属性值原样保护,防 _ * 污染)
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? '')
  return t
}

function isHr(line: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
}

interface Lines {
  arr: string[]
  i: number
}

function parseFencedCode(ln: Lines): string {
  const fence = ln.arr[ln.i].trim()
  const lang = fence.slice(3).trim()
  const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : ''
  const dataLang = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
  const out = [`<pre${dataLang}><code${langAttr}>`]
  ln.i++
  while (ln.i < ln.arr.length && !ln.arr[ln.i].trim().startsWith('```')) {
    out.push(escapeHtml(ln.arr[ln.i]))
    ln.i++
  }
  ln.i++ // 跳过结束 ```
  out.push('</code></pre>')
  return out.join('\n')
}

function parseTable(ln: Lines): string {
  const rows: string[] = []
  while (ln.i < ln.arr.length && ln.arr[ln.i].trim().startsWith('|')) {
    rows.push(ln.arr[ln.i].trim())
    ln.i++
  }
  if (rows.length < 2) return ''
  const headers = rows[0]
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
  const parts = ['<table>', '<thead><tr>']
  for (const h of headers) parts.push(`<th>${parseInline(h)}</th>`)
  parts.push('</tr></thead><tbody>')
  for (const row of rows.slice(2)) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    parts.push('<tr>')
    for (const c of cells) parts.push(`<td>${parseInline(c)}</td>`)
    parts.push('</tr>')
  }
  parts.push('</tbody></table>')
  return parts.join('\n')
}

function parseBlockquote(ln: Lines): string {
  const content: string[] = []
  while (ln.i < ln.arr.length && ln.arr[ln.i].startsWith('>')) {
    content.push(ln.arr[ln.i].slice(1).trim())
    ln.i++
  }
  const html = parseInline(content.join(' '))
  const callouts: Record<string, RegExp> = {
    note: /^\s*<strong>(?:note|注意|说明)<\/strong>/i,
    warning: /^\s*<strong>(?:warning|warn|警告|当心)<\/strong>/i,
    tip: /^\s*<strong>(?:tip|提示|技巧)<\/strong>/i,
    info: /^\s*<strong>(?:info|信息|相关信息)<\/strong>/i,
    key: /^\s*<strong>(?:关键|重点|核心)<\/strong>/i,
  }
  for (const [cls, pat] of Object.entries(callouts)) {
    if (pat.test(html)) return `<blockquote class="callout callout-${cls}">${html}</blockquote>`
  }
  return `<blockquote>${html}</blockquote>`
}

function parseList(ln: Lines, ordered: boolean): string {
  const tag = ordered ? 'ol' : 'ul'
  const items: string[] = []
  while (ln.i < ln.arr.length) {
    const raw = ln.arr[ln.i]
    const s = raw.replace(/^\s+/, '')
    if (ordered && /^\d+\.\s/.test(s)) {
      items.push(s.replace(/^\d+\.\s/, ''))
      ln.i++
    } else if (!ordered && /^[-*+]\s/.test(s)) {
      items.push(s.replace(/^[-*+]\s/, ''))
      ln.i++
    } else if (s === '') {
      ln.i++
    } else {
      break
    }
  }
  const out = [`<${tag}>`]
  for (const it of items) out.push(`<li>${parseInline(it)}</li>`)
  out.push(`</${tag}>`)
  return out.join('\n')
}

/** mdToHtml 的 body 版:已剥 frontmatter。buildView 复用避免重复 splitFrontmatter。 */
export function mdToHtmlBody(body: string): string {
  const arr = body.split('\n')
  const ln: Lines = { arr, i: 0 }
  const out: string[] = []

  while (ln.i < arr.length) {
    const s = arr[ln.i].trim()
    if (s === '') {
      ln.i++
      continue
    }
    if (s.startsWith('```')) {
      out.push(parseFencedCode(ln))
      continue
    }
    if (isHr(arr[ln.i])) {
      out.push('<hr />')
      ln.i++
      continue
    }
    if (s.startsWith('>')) {
      out.push(parseBlockquote(ln))
      continue
    }
    if (s.startsWith('|')) {
      const start = ln.i
      const tbl = parseTable(ln)
      if (tbl) {
        out.push(tbl)
        continue
      }
      // 单行 |(parseTable 返回 '',ln.i 已推进过该 | 行):当段落消费。
      // 否则落到下方段落解析,段落遇 | 即 break 不推进 -> 外层 while 死循环。
      out.push(`<p>${parseInline(arr[start])}</p>`)
      continue
    }
    // \s+ 后锚 \S 消除回溯歧义(纯空格行不匹配,CodeQL js/polynomial-redos);同一模式见 consumeParagraph/段落中断判断。
    const hm = /^(#{1,6})\s+(\S.*)$/.exec(s)
    if (hm) {
      const level = hm[1].length
      out.push(`<h${level}>${parseInline(hm[2])}</h${level}>`)
      ln.i++
      continue
    }
    if (/^[-*+]\s/.test(s)) {
      out.push(parseList(ln, false))
      continue
    }
    if (/^\d+\.\s/.test(s)) {
      out.push(parseList(ln, true))
      continue
    }
    // 段落
    const para: string[] = []
    while (ln.i < arr.length) {
      const cl = arr[ln.i]
      const cs = cl.trim()
      if (cs === '') {
        ln.i++
        break
      }
      if (
        cs.startsWith('```') ||
        cs.startsWith('|') ||
        cs.startsWith('>') ||
        /^(#{1,6})\s+(\S.*)$/.test(cs) ||
        /^[-*+]\s/.test(cs) ||
        /^\d+\.\s/.test(cs) ||
        isHr(cl)
      )
        break
      para.push(cs)
      ln.i++
    }
    if (para.length) out.push(`<p>${parseInline(para.join(' '))}</p>`)
  }
  return out.join('\n')
}

export function mdToHtml(mdText: string): string {
  return mdToHtmlBody(splitFrontmatter(mdText).body)
}

export interface Block {
  /** 块原文(不含块间空行分隔) */
  text: string
  /** true=已闭合可缓存;false=末尾正在写需重算 */
  complete: boolean
}

/**
 * 把 markdown 切成块级单元(段落/代码块/列表/表格/引用/标题/hr),块边界识别与
 * mdToHtml 的 while 扫描一致(一致性见 markdown.test.ts 的"整体 == 各块再 join"用例)。
 * 流式渲染用:complete 块缓存 mdToHtml 结果,只有末尾 partial 块重算。
 *
 * complete 判定:代码块需遇结束 fence;其他块需其后还有内容(空行或下一块)。
 * 故仅最后一个块可能 partial,其余 complete。
 */
export function splitBlocks(mdText: string): Block[] {
  const { body } = splitFrontmatter(mdText)
  const arr = body.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < arr.length) {
    const s = arr[i].trim()
    if (s === '') {
      i++
      continue
    }
    const start = i
    let codeClosed = false
    if (s.startsWith('```')) {
      i++
      while (i < arr.length && !arr[i].trim().startsWith('```')) i++
      if (i < arr.length) {
        codeClosed = true
        i++
      }
    } else if (isHr(arr[i])) {
      i++
    } else if (s.startsWith('>')) {
      while (i < arr.length && arr[i].startsWith('>')) i++
    } else if (s.startsWith('|')) {
      while (i < arr.length && arr[i].trim().startsWith('|')) i++
    } else if (/^(#{1,6})\s+/.test(s)) {
      i++
    } else if (/^[-*+]\s/.test(s) || /^\d+\.\s/.test(s)) {
      while (i < arr.length) {
        const t = arr[i].replace(/^\s+/, '')
        if (/^[-*+]\s/.test(t) || /^\d+\.\s/.test(t) || t === '') {
          i++
          continue
        }
        break
      }
    } else {
      i = consumeParagraph(arr, i)
    }
    let end = i
    while (end > start && arr[end - 1].trim() === '') end--
    const text = arr.slice(start, end).join('\n')
    const isCode = s.startsWith('```')
    blocks.push({ text, complete: isCode ? codeClosed : i < arr.length })
  }
  return blocks
}

/** 段落:连续非空、非块起始行,遇空行或块起始停止(空行吃一个,同 mdToHtml 段落解析)。 */
function consumeParagraph(arr: string[], i: number): number {
  while (i < arr.length) {
    const cs = arr[i].trim()
    if (cs === '') {
      i++
      break
    }
    if (
      cs.startsWith('```') ||
      cs.startsWith('|') ||
      cs.startsWith('>') ||
      /^(#{1,6})\s+(\S.*)$/.test(cs) ||
      /^[-*+]\s/.test(cs) ||
      /^\d+\.\s/.test(cs) ||
      isHr(arr[i])
    )
      break
    i++
  }
  return i
}
