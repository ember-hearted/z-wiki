import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { collectReport, runHealthCheck } from './healthCheck.js'

// 构造临时 kbRoot(kb/ 根),写入给定相对路径->内容映射(复用 buildView.test 模式)。
async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-hc-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf-8')
  }
  return root
}

test('collectReport: 断链/孤儿/空文件/frontmatter/统计', async () => {
  const root = await makeProject({
    'wiki/01-a.md': '---\nview: true\n---\n# A\n\n[[02-b]]\n', // 引用 02-b(存在),无入链->孤儿
    'wiki/02-b.md': '---\nview: true\n---\n# B\n\n[[missing]]\n', // 引用 missing(断链),被 01-a 引用
    'wiki/03-c.md': '---\nview: true\n---\n# C\n\nbody\n', // 无引用无入链->孤儿
    'wiki/04-empty.md': '---\nview: true\n---\n', // 仅 frontmatter->空文件+孤儿
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.fileCount, 4)
    assert.equal(r.wikiCount, 4)
    // 断链:02-b -> missing
    assert.equal(r.broken.length, 1)
    assert.equal(r.broken[0].from, 'wiki/02-b.md')
    assert.equal(r.broken[0].target, 'missing')
    // 孤儿:01-a、03-c、04-empty(02-b 被 01-a 引用,非孤儿)
    assert.deepEqual(r.orphans.map((o) => o.rel).sort(), [
      'wiki/01-a.md',
      'wiki/03-c.md',
      'wiki/04-empty.md',
    ])
    // 空文件:04-empty
    assert.deepEqual(
      r.empties.map((e) => e.rel),
      ['wiki/04-empty.md'],
    )
    // frontmatter 全覆盖
    assert.equal(r.frontmatterPct, 100)
    // wikiStats 4 项
    assert.equal(r.wikiStats.length, 4)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('collectReport: 重复文件名(raw + wiki 同 stem)', async () => {
  const root = await makeProject({
    'wiki/dup.md': '---\n---\n# Dup\n',
    'raw/dup.md': '---\n---\n# Dup raw\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.dups.length, 1)
    assert.equal(r.dups[0].stem, 'dup')
    assert.deepEqual(r.dups[0].paths.sort(), ['raw/dup.md', 'wiki/dup.md'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('stalePromotions: wiki 标了 promoted-to 但 output 不存在', async () => {
  const root = await makeProject({
    'wiki/05-RAG.md': '---\npromoted-to: 2026-07-21-RAG-报告\n---\n# RAG\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.stalePromotions.length, 1)
    assert.equal(r.stalePromotions[0].wikiRel, 'wiki/05-RAG.md')
    assert.equal(r.stalePromotions[0].promotedTo, '2026-07-21-RAG-报告')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('stalePromotions: output 存在时不报', async () => {
  const root = await makeProject({
    'wiki/05-RAG.md': '---\npromoted-to: 2026-07-21-RAG-报告\n---\n# RAG\n',
    'output/2026-07-21-RAG-报告.md': '---\npublish: true\n---\n# Out\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.stalePromotions.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('suggestedPromotions: 根据 stem 共有的 token 推荐晋升关系', async () => {
  const root = await makeProject({
    'wiki/05-RAG-实践.md': '# RAG 实践\n',
    'output/2026-07-21-RAG-系统对比-报告.md': '# RAG 报告\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.suggestedPromotions.length, 1)
    assert.equal(r.suggestedPromotions[0].wikiStem, '05-RAG-实践')
    assert.equal(r.suggestedPromotions[0].outputStem, '2026-07-21-RAG-系统对比-报告')
    assert.ok(r.suggestedPromotions[0].commonTokens.includes('RAG'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('suggestedPromotions: 已设 promoted-to 的 wiki 不再建议', async () => {
  const root = await makeProject({
    'wiki/05-RAG-实践.md': '---\npromoted-to: 2026-07-21-RAG-报告\n---\n# RAG 实践\n',
    'output/2026-07-21-RAG-报告.md': '# RAG 报告\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.suggestedPromotions.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('suggestedPromotions: 无显著 token 重叠时不误报', async () => {
  const root = await makeProject({
    'wiki/01-LLM-基础.md': '# LLM 基础\n',
    'output/2026-07-21-React-组件重构-报告.md': '# React 报告\n',
  })
  try {
    const r = await collectReport(root)
    assert.equal(r.suggestedPromotions.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('runHealthCheck 是 collectReport 的别名(同行为)', async () => {
  const root = await makeProject({ 'wiki/x.md': '---\nview: true\n---\n# X\n\nbody\n' })
  try {
    const a = await collectReport(root)
    const b = await runHealthCheck(root)
    assert.deepEqual(a, b)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
