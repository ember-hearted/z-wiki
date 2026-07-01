// healthCheck.ts — TS 版知识库健康检查(替代 share_wsl 的 4 个重复 Python 脚本)
// 检查项:断链扫描、孤儿 wiki、空文件、重复文件名、frontmatter 覆盖率、wiki 统计
// 用法:npm run health  (tsx scripts/healthCheck.ts)
// 报告输出到 health-check/YYYY-MM-DD-知识库健康检查-报告.md(与 output/ 同级,不进可视层)
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// layer1 内容集中在 kb/(ADR-0002),健康检查只扫知识库
const VAULT = path.resolve(__dirname, "..", "kb");

const SKIP_DIRS = new Set([".git", ".obsidian", ".claude", ".firecrawl", ".playwright-mcp", "__pycache__", "node_modules", "dist", ".pi"]);
const NON_MD_EXT = new Set([".srt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".csv", ".json", ".svg", ".avif"]);
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
];

interface MdFile {
  abs: string;
  rel: string;
  stem: string;
  content: string;
}

async function gatherMdFiles(): Promise<MdFile[]> {
  const out: MdFile[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".") || e.name.startsWith("_")) continue;
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const content = await fs.readFile(full, "utf-8");
        out.push({
          abs: full,
          rel: path.relative(VAULT, full),
          stem: e.name.replace(/\.md$/, ""),
          content,
        });
      }
    }
  }
  await walk(VAULT);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function isPlaceholder(target: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(target));
}

function extractWikilinks(text: string): string[] {
  // 去代码块与行内代码
  const noFence = text.replace(/```[\s\S]*?```/g, "");
  const noInline = noFence.replace(/`[^`]+`/g, "");
  const links: string[] = [];
  for (const m of noInline.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const raw = m[1].trim();
    if (!raw) continue;
    const target = raw.split("|")[0].replace(/\\+$/, "").trim();
    if (!target || isPlaceholder(target)) continue;
    links.push(target);
  }
  return links;
}

function resolveWikilink(target: string, files: MdFile[]): MdFile | null {
  const ext = path.extname(target).toLowerCase();
  if (ext && NON_MD_EXT.has(ext)) return null;
  // raw/ 引用:只检查 raw 下是否存在(原文,不强求 .md)
  if (target.startsWith("raw/") || target.startsWith("./raw/")) {
    const p = path.join(VAULT, target.replace(/^\.\//, ""));
    return existsSync(p) ? { abs: p, rel: target, stem: "", content: "" } : null;
  }
  // stem 精确匹配(大小写不敏感)
  const targetStem = path.basename(target).replace(/\.md$/i, "").toLowerCase();
  const matches = files.filter((f) => f.stem.toLowerCase() === targetStem);
  return matches.length === 1 ? matches[0] : matches.length > 1 ? matches[0] : null;
}

function hasFrontmatter(content: string): boolean {
  return content.startsWith("---");
}

function isEmptyOrOnlyFrontmatter(content: string): boolean {
  if (!content.trim()) return true;
  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end === -1) return false;
    return content.slice(end + 3).trim().length === 0;
  }
  return false;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const files = await gatherMdFiles();
  const wikiDir = path.join(VAULT, "wiki");
  const wikiFiles = files.filter((f) => f.abs.startsWith(wikiDir + path.sep) || f.abs.startsWith(wikiDir));

  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`tags: [健康检查]`);
  lines.push(`updated: ${today()}`);
  lines.push(`status: active`);
  lines.push(`view: false`);
  lines.push(`---`);
  lines.push(``);
  lines.push(`# 知识库健康检查 ${today()}`);
  lines.push(``);
  lines.push(`> 共 ${files.length} 个 .md 文件,wiki/ ${wikiFiles.length} 个。`);
  lines.push(``);
  lines.push(`## 检查项概览`);
  lines.push(``);
  lines.push(`| 检查项 | 状态 | 详情 |`);
  lines.push(`|------|------|------|`);

  // 1. 断链扫描
  const broken: { from: string; target: string }[] = [];
  for (const f of files) {
    for (const target of extractWikilinks(f.content)) {
      if (!resolveWikilink(target, files)) {
        broken.push({ from: f.rel, target });
      }
    }
  }
  lines.push(`| 断链扫描 | ${broken.length === 0 ? "✅ 无断链" : `⚠️ ${broken.length} 条`} | ${broken.length ? "见下表" : "—"} |`);

  // 2. 孤儿 wiki(未被任何其他 .md 引用)
  const referencedStems = new Set<string>();
  for (const f of files) {
    for (const target of extractWikilinks(f.content)) {
      const resolved = resolveWikilink(target, files);
      if (resolved && resolved.stem) referencedStems.add(resolved.stem.toLowerCase());
    }
  }
  const orphans = wikiFiles.filter((w) => !referencedStems.has(w.stem.toLowerCase()) && w.stem !== "00-知识库导航");
  lines.push(`| 孤儿 wiki | ${orphans.length === 0 ? "✅ 无孤儿" : `⚠️ ${orphans.length} 篇`} | ${orphans.length ? orphans.map((o) => o.stem).join(", ") : "—"} |`);

  // 3. 空文件
  const empties = files.filter((f) => isEmptyOrOnlyFrontmatter(f.content));
  lines.push(`| 空文件 | ${empties.length === 0 ? "✅ 无" : `⚠️ ${empties.length} 个`} | ${empties.length ? empties.map((e) => e.rel).join(", ") : "—"} |`);

  // 4. 重复文件名
  const nameCount = new Map<string, string[]>();
  for (const f of files) {
    const arr = nameCount.get(f.stem) ?? [];
    arr.push(f.rel);
    nameCount.set(f.stem, arr);
  }
  const dups = [...nameCount.entries()].filter(([, arr]) => arr.length > 1);
  lines.push(`| 重复文件名 | ${dups.length === 0 ? "✅ 无" : `⚠️ ${dups.length} 组`} | ${dups.length ? dups.map(([s, arr]) => `${s}(${arr.length})`).join(", ") : "—"} |`);

  // 5. frontmatter 覆盖率
  const withFm = files.filter((f) => hasFrontmatter(f.content)).length;
  const pct = files.length ? Math.round((withFm / files.length) * 100) : 0;
  lines.push(`| Frontmatter 覆盖率 | ${pct >= 80 ? "✅" : "⚠️"} ${pct}% | ${withFm}/${files.length} |`);

  // 6. wiki 统计
  lines.push(`| Wiki 统计 | ℹ️ ${wikiFiles.length} 篇 | 见下表 |`);

  lines.push(``);
  lines.push(`## 断链详情`);
  lines.push(``);
  if (broken.length === 0) {
    lines.push(`无断链。`);
  } else {
    lines.push(`| 来源 | 目标 |`);
    lines.push(`|------|------|`);
    for (const b of broken) lines.push(`| ${b.from} | ${b.target} |`);
  }
  lines.push(``);
  lines.push(`## 孤儿 wiki`);
  lines.push(``);
  if (orphans.length === 0) {
    lines.push(`无孤儿页面。`);
  } else {
    for (const o of orphans) lines.push(`- [[${o.stem}]]`);
  }
  lines.push(``);
  lines.push(`## Wiki 文件统计`);
  lines.push(``);
  lines.push(`| 文件 | 行数 | frontmatter |`);
  lines.push(`|------|------:|:---:|`);
  for (const w of wikiFiles) {
    const lc = w.content.split("\n").length;
    lines.push(`| [[${w.stem}]] | ${lc} | ${hasFrontmatter(w.content) ? "✅" : "—"} |`);
  }

  const reportDir = path.join(VAULT, "health-check");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${today()}-知识库健康检查-报告.md`);
  await fs.writeFile(reportPath, lines.join("\n"), "utf-8");

  // 终端摘要
  console.log(`知识库健康检查完成 → ${path.relative(VAULT, reportPath)}`);
  console.log(`  .md 文件: ${files.length}  wiki: ${wikiFiles.length}`);
  console.log(`  断链: ${broken.length}  孤儿: ${orphans.length}  空文件: ${empties.length}  重复: ${dups.length}  frontmatter: ${pct}%`);
}

main().catch((err) => {
  console.error("健康检查失败:", err);
  process.exit(1);
});
