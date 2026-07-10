import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { collectReport, formatReport, runHealthCheck, type HealthReport } from './healthCheck.js'

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

test('formatReport: 输出含各检查项段落', () => {
  const report: HealthReport = {
    fileCount: 4,
    wikiCount: 3,
    broken: [{ from: 'wiki/02-b.md', target: 'missing' }],
    orphans: [{ rel: 'wiki/03-c.md', stem: '03-c' }],
    empties: [{ rel: 'wiki/04-empty.md' }],
    dups: [],
    frontmatterPct: 75,
    wikiStats: [{ stem: '01-a', lines: 5, hasFrontmatter: true }],
  }
  const md = formatReport(report)
  assert.ok(md.includes('断链详情'), '含断链详情段')
  assert.ok(md.includes('孤儿 wiki'), '含孤儿 wiki 段')
  assert.ok(md.includes('Wiki 文件统计'), '含 Wiki 文件统计段')
  assert.ok(md.includes('missing'), '含断链目标')
  assert.ok(md.includes('75%'), '含 frontmatter 覆盖率')
})
