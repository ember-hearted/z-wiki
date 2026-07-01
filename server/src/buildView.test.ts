import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildView, type PageMeta } from "./buildView.js";

// 构造临时 projectRoot,写入给定相对路径→内容映射。
async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zwiki-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }
  return root;
}

const longBody = (n: number): string =>
  Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

const stems = (pages: PageMeta[]): Set<string> =>
  new Set(pages.map((p) => p.stem));

test("wiki: view:true published, view:false skipped", async () => {
  const root = await makeProject({
    "kb/wiki/01-foo.md": "---\nview: true\n---\n# Foo\n\n## Section\n\ntext\n",
    "kb/wiki/02-hidden.md": "---\nview: false\n---\n# Hidden\n\nbody\n",
  });
  try {
    const { pages, fragments } = await buildView(root);
    assert.ok(stems(pages).has("01-foo"));
    assert.ok(!stems(pages).has("02-hidden"));
    assert.ok(fragments.has("01-foo"));
    assert.ok(!fragments.has("02-hidden"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("output: publish flag overrides line count; ≥30 lines default published", async () => {
  const root = await makeProject({
    "kb/output/short-published.md": "---\npublish: true\n---\n# Short\n\nshort\n",
    "kb/output/short-draft.md": "# Draft\n\nshort\n",
    "kb/output/long.md": "# Long\n\n" + longBody(35),
  });
  try {
    const { pages } = await buildView(root);
    assert.ok(stems(pages).has("short-published"), "publish:true short should be published");
    assert.ok(!stems(pages).has("short-draft"), "short without publish should be skipped");
    assert.ok(stems(pages).has("long"), "≥30 lines should be published");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("health-check 与 output 同级,不被 buildView 扫描", async () => {
  const root = await makeProject({
    "kb/health-check/report.md": "---\npublish: true\n---\n# HC\n\nx\n",
    "kb/output/real.md": "---\npublish: true\n---\n# Real\n\nx\n",
  });
  try {
    const { pages } = await buildView(root);
    assert.ok(!stems(pages).has("report"), "health-check 同级,不在扫描范围");
    assert.ok(stems(pages).has("real"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("fragment wraps prose, excludes frontmatter, renders wikilink + toc", async () => {
  const root = await makeProject({
    "kb/wiki/01-foo.md":
      "---\nview: true\n---\n# Foo\n\n## Section\n\nsee [[02-bar]] and [[raw/x]]\n",
  });
  try {
    const { fragments, pages } = await buildView(root);
    const frag = fragments.get("01-foo");
    assert.ok(frag, "fragment present");
    assert.ok(frag!.startsWith('<article class="prose">'));
    assert.ok(!frag!.includes("view: true"), "frontmatter must not leak into fragment");
    // [[02-bar]] → <a href="./02-bar.html">;[[raw/x]] → 纯文本(不以 .html)
    assert.ok(frag!.includes('href="./02-bar.html"'));
    assert.ok(!frag!.includes('href="./raw/x.html"'));

    const foo = pages.find((p) => p.stem === "01-foo");
    assert.equal(foo?.toc.length, 1);
    assert.equal(foo?.toc[0].text, "Section");
    assert.equal(foo?.toc[0].level, "h2");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
