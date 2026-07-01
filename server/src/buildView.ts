// buildView.ts — 知识库 → 可视数据 的纯函数编译器。
// 扫描 wiki/(view:true)与 output/ 的 .md,编译为内存结构:
//   pages     — PageMeta[] 索引(供前端列表/导航)
//   fragments — Map<stem, html> 文章片段(<article class="prose">...)
// 纯函数:只读文件系统,不写盘。由 Interaction 缓存结果并经 HTTP 暴露。
// md→html 1:1 平移自原 Python 版。
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { wikiDir, outputDir } from "./kbLayout.js";

export interface TocItem {
  level: "h2" | "h3";
  text: string;
}

export interface PageMeta {
  stem: string;
  title: string;
  summary: string;
  updated: string;
  toc: TocItem[];
  type: "wiki" | "output";
}

export interface BuildResult {
  pages: PageMeta[];
  fragments: Map<string, string>;
}

const DEFAULT_MIN_LINES = 30;
const SKIP_TOC = new Set(["来源", "相关主题", "参考", "参考文档"]);

// ── frontmatter ──────────────────────────────────────────────
function splitFrontmatter(text: string): { body: string; fm: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { body: text, fm: "" };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { body: lines.slice(i + 1).join("\n"), fm: lines.slice(1, i).join("\n") };
    }
  }
  return { body: text, fm: "" };
}

function fmField(fm: string, field: string): boolean | null {
  for (const line of fm.split("\n")) {
    const s = line.trim();
    if (s.startsWith(`${field}:`)) {
      const val = s.split(":").slice(1).join(":").trim().toLowerCase();
      return val === "true" || val === "yes" || val === "1";
    }
  }
  return null;
}

// ── md → html(行内 + 块级,1:1 平移 Python 版)──────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseInline(text: string): string {
  let t = escapeHtml(text);
  // 图片 ![alt](url)
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // wikilink [[a|b]] / [[a]]
  const wikilink = (p: string, label: string): string => {
    if (p.startsWith("raw/") || p.startsWith("./raw/")) return label;
    return `<a href="./${p}.html" class="wl">${label}</a>`;
  };
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, p, lbl) => wikilink(p, lbl));
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_m, p) => wikilink(p, p));
  // 链接 [text](url)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // 加粗 / 斜体 / 行内代码 / 删除线
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__(.+?)__/g, "<strong>$1</strong>");
  t = t.replace(/\*(.+?)\*/g, "<em>$1</em>");
  t = t.replace(/_(.+?)_/g, "<em>$1</em>");
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return t;
}

function isHr(line: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim());
}

interface Lines {
  arr: string[];
  i: number;
}

function parseFencedCode(ln: Lines): string {
  const fence = ln.arr[ln.i].trim();
  const lang = fence.slice(3).trim();
  const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  const dataLang = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
  const out = [`<pre${dataLang}><code${langAttr}>`];
  ln.i++;
  while (ln.i < ln.arr.length && !ln.arr[ln.i].trim().startsWith("```")) {
    out.push(escapeHtml(ln.arr[ln.i]));
    ln.i++;
  }
  ln.i++; // 跳过结束 ```
  out.push("</code></pre>");
  return out.join("\n");
}

function parseTable(ln: Lines): string {
  const rows: string[] = [];
  while (ln.i < ln.arr.length && ln.arr[ln.i].trim().startsWith("|")) {
    rows.push(ln.arr[ln.i].trim());
    ln.i++;
  }
  if (rows.length < 2) return "";
  const headers = rows[0].split("|").slice(1, -1).map(c => c.trim());
  const parts = ["<table>", "<thead><tr>"];
  for (const h of headers) parts.push(`<th>${parseInline(h)}</th>`);
  parts.push("</tr></thead><tbody>");
  for (const row of rows.slice(2)) {
    const cells = row.split("|").slice(1, -1).map(c => c.trim());
    parts.push("<tr>");
    for (const c of cells) parts.push(`<td>${parseInline(c)}</td>`);
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("\n");
}

function parseBlockquote(ln: Lines): string {
  const content: string[] = [];
  while (ln.i < ln.arr.length && ln.arr[ln.i].startsWith(">")) {
    content.push(ln.arr[ln.i].slice(1).trim());
    ln.i++;
  }
  const html = parseInline(content.join(" "));
  const callouts: Record<string, RegExp> = {
    note: /^\s*<strong>(?:note|注意|说明)<\/strong>/i,
    warning: /^\s*<strong>(?:warning|warn|警告|当心)<\/strong>/i,
    tip: /^\s*<strong>(?:tip|提示|技巧)<\/strong>/i,
    info: /^\s*<strong>(?:info|信息|相关信息)<\/strong>/i,
    key: /^\s*<strong>(?:关键|重点|核心)<\/strong>/i,
  };
  for (const [cls, pat] of Object.entries(callouts)) {
    if (pat.test(html)) return `<blockquote class="callout callout-${cls}">${html}</blockquote>`;
  }
  return `<blockquote>${html}</blockquote>`;
}

function parseList(ln: Lines, ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const items: string[] = [];
  while (ln.i < ln.arr.length) {
    const raw = ln.arr[ln.i];
    const s = raw.replace(/^\s+/, "");
    if (ordered && /^\d+\.\s/.test(s)) {
      items.push(s.replace(/^\d+\.\s/, ""));
      ln.i++;
    } else if (!ordered && /^[-*+]\s/.test(s)) {
      items.push(s.replace(/^[-*+]\s/, ""));
      ln.i++;
    } else if (s === "") {
      ln.i++;
    } else {
      break;
    }
  }
  const out = [`<${tag}>`];
  for (const it of items) out.push(`<li>${parseInline(it)}</li>`);
  out.push(`</${tag}>`);
  return out.join("\n");
}

export function mdToHtml(mdText: string): string {
  const { body } = splitFrontmatter(mdText);
  const arr = body.split("\n");
  const ln: Lines = { arr, i: 0 };
  const out: string[] = [];

  while (ln.i < arr.length) {
    const s = arr[ln.i].trim();
    if (s === "") { ln.i++; continue; }
    if (s.startsWith("```")) { out.push(parseFencedCode(ln)); continue; }
    if (isHr(arr[ln.i])) { out.push("<hr />"); ln.i++; continue; }
    if (s.startsWith(">")) { out.push(parseBlockquote(ln)); continue; }
    if (s.startsWith("|")) {
      const start = ln.i;
      const tbl = parseTable(ln);
      if (tbl) { out.push(tbl); continue; }
      ln.i = start; // 不是表,回退
    }
    const hm = /^(#{1,6})\s+(.+)$/.exec(s);
    if (hm) {
      const level = hm[1].length;
      out.push(`<h${level}>${parseInline(hm[2])}</h${level}>`);
      ln.i++;
      continue;
    }
    if (/^[-*+]\s/.test(s)) { out.push(parseList(ln, false)); continue; }
    if (/^\d+\.\s/.test(s)) { out.push(parseList(ln, true)); continue; }
    // 段落
    const para: string[] = [];
    while (ln.i < arr.length) {
      const cl = arr[ln.i];
      const cs = cl.trim();
      if (cs === "") { ln.i++; break; }
      if (cs.startsWith("```") || cs.startsWith("|") || cs.startsWith(">")
          || cs.startsWith("#") || /^[-*+]\s/.test(cs) || /^\d+\.\s/.test(cs) || isHr(cl)) break;
      para.push(cs);
      ln.i++;
    }
    if (para.length) out.push(`<p>${parseInline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ── 元信息提取 ───────────────────────────────────────────────
function extractTitle(text: string): string | null {
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.startsWith("# ") && !s.startsWith("## ")) return s.slice(2).trim();
  }
  return null;
}

function buildToc(mdText: string): TocItem[] {
  const { body } = splitFrontmatter(mdText);
  const toc: TocItem[] = [];
  for (const line of body.split("\n")) {
    const s = line.trim();
    let text = "";
    let level: "h2" | "h3" | null = null;
    if (s.startsWith("## ") && !s.startsWith("### ")) { level = "h2"; text = s.slice(3).trim(); }
    else if (s.startsWith("### ") && !s.startsWith("#### ")) { level = "h3"; text = s.slice(4).trim(); }
    if (level && text) {
      const clean = text.replace(/\*\*(.+?)\*\*/g, "$1");
      if (!SKIP_TOC.has(clean)) toc.push({ level, text: clean });
    }
  }
  return toc;
}

function extractSummary(mdText: string): string {
  const { body } = splitFrontmatter(mdText);
  for (const line of body.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith("#") || s.startsWith(">") || s.startsWith("```") || s.startsWith("|")) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) continue;
    if (/^[-*+]\s/.test(s) || /^\d+\.\s/.test(s)) continue;
    const clean = s.replace(/<[^>]+>/g, "").replace(/\*\*(.+?)\*\*/g, "$1");
    return clean.slice(0, 120);
  }
  return "";
}

// ── 文件扫描 ─────────────────────────────────────────────────
interface Source {
  abs: string;
  rel: string;
  stem: string;
  type: "wiki" | "output";
}

function shouldPublish(src: Source, mdText: string, minLines: number): boolean {
  const { fm } = splitFrontmatter(mdText);
  if (src.type === "wiki") {
    return fmField(fm, "view") === true;
  }
  // output: publish 标记优先,否则按行数
  const pub = fmField(fm, "publish");
  if (pub !== null) return pub;
  const lineCount = mdText.trim() ? mdText.trim().split("\n").length : 0;
  return lineCount >= minLines;
}

async function scanSources(projectRoot: string): Promise<Source[]> {
  const wiki = wikiDir(projectRoot);
  const output = outputDir(projectRoot);
  const sources: Source[] = [];
  for (const [dir, type] of [[wiki, "wiki"], [output, "output"]] as const) {
    if (!existsSync(dir)) continue;
    const files = await fs.readdir(dir);
    for (const f of files.sort()) {
      if (!f.endsWith(".md")) continue;
      const abs = path.join(dir, f);
      sources.push({
        abs,
        rel: path.relative(projectRoot, abs),
        stem: f.replace(/\.md$/, ""),
        type,
      });
    }
  }
  return sources;
}

// ── 主构建 ───────────────────────────────────────────────────
export async function buildView(projectRoot: string): Promise<BuildResult> {
  const sources = await scanSources(projectRoot);
  const minLines = DEFAULT_MIN_LINES;
  const publishable: Source[] = [];
  for (const src of sources) {
    const mdText = await fs.readFile(src.abs, "utf-8");
    if (shouldPublish(src, mdText, minLines)) publishable.push(src);
  }

  const pages: PageMeta[] = [];
  const fragments = new Map<string, string>();
  for (const src of publishable) {
    const mdText = await fs.readFile(src.abs, "utf-8");
    const stat = await fs.stat(src.abs);
    const title = extractTitle(mdText) ?? src.stem;
    fragments.set(src.stem, `<article class="prose">\n${mdToHtml(mdText)}\n</article>`);
    pages.push({
      stem: src.stem,
      title,
      summary: extractSummary(mdText),
      updated: stat.mtime.toISOString().slice(0, 10),
      toc: buildToc(mdText),
      type: src.type,
    });
  }

  return { pages, fragments };
}
