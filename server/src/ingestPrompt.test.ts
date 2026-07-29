// ingestPrompt.test.ts - ingest 触发 prompt 构造单测。
// 从 interaction.ts 的 runIngest 闭包外提为 buildIngestPrompt(rawName) 纯函数后的行为锁定:
// md/非 md 的 readHint 分支、rawName 插值、§1 引用、7 步结构(含编译小结契约,ADR-0024)。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildIngestPrompt } from './ingestPrompt.js'

// ── md 文件:走 read,不指示 pandoc ────────────────────────────────

test('buildIngestPrompt: md 文件 -> readHint 指示 read,不含 pandoc', () => {
  const p = buildIngestPrompt('01-note.md')
  assert.ok(p.includes('已上传文件 raw/01-note.md。请按 Ingest 工作流处理:'))
  assert.ok(p.includes('1. 读取 raw/01-note.md 内容'))
  assert.ok(!p.includes('pandoc'), 'md 文件不应指示 pandoc')
})

test('buildIngestPrompt: 大写 .MD 后缀 -> 仍按 md 处理(ext 小写化)', () => {
  const p = buildIngestPrompt('NOTE.MD')
  assert.ok(p.includes('1. 读取 raw/NOTE.MD 内容'))
  assert.ok(!p.includes('pandoc'))
})

// ── 纯文本文件(.txt/.text/.log):走 read,不指示 pandoc(ADR-0018)──────────

test('buildIngestPrompt: 纯文本后缀 -> readHint 指示 read,不含 pandoc', () => {
  for (const ext of ['.txt', '.text', '.log']) {
    const p = buildIngestPrompt(`notes${ext}`)
    assert.ok(p.includes(`1. 读取 raw/notes${ext} 内容`), `${ext} 应指示 read`)
    assert.ok(!p.includes('pandoc'), `${ext} 不应指示 pandoc`)
  }
})

// ── 非 md 文件:走 pandoc ─────────────────────────────────────────

test('buildIngestPrompt: 非 md 文件 -> readHint 指示 pandoc 工具', () => {
  const p = buildIngestPrompt('report.docx')
  assert.ok(
    p.includes(
      '1. raw/report.docx 是非 md 文件,用 pandoc 工具转文本读取:pandoc({ filePath: "raw/report.docx" })',
    ),
  )
  assert.ok(!p.includes('1. 读取 raw/report.docx 内容'), '非 md 不应指示 read')
})

test('buildIngestPrompt: 无后缀 -> 按非 md 处理(pandoc)', () => {
  const p = buildIngestPrompt('README')
  assert.ok(p.includes('pandoc({ filePath: "raw/README" })'))
  assert.ok(!p.includes('1. 读取 raw/README 内容'))
})

test('buildIngestPrompt: .markdown 后缀 -> 按 非 md 处理(只认精确 .md)', () => {
  // 现行契约:只有精确 .md 走 read,其余(含 .markdown)走 pandoc。锁定此行为。
  const p = buildIngestPrompt('notes.markdown')
  assert.ok(p.includes('pandoc'))
})

// ── 共同结构:插值 / §1 引用 / 7 步 / 来源引用 ───────────────────

test('buildIngestPrompt: rawName 插值到 header + 来源引用 [[raw/X]]', () => {
  const p = buildIngestPrompt('study/01-note.md')
  assert.ok(p.includes('已上传文件 raw/study/01-note.md'))
  assert.ok(p.includes('[[raw/study/01-note.md]]'))
})

test('buildIngestPrompt: 引用 §1 编译规则', () => {
  const p = buildIngestPrompt('x.md')
  assert.ok(p.includes('§1 编译规则'))
})

test('buildIngestPrompt: 含 7 步结构(1. .. 7.)', () => {
  const p = buildIngestPrompt('x.md')
  for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.']) {
    assert.ok(p.includes(n), `应含步骤 ${n}`)
  }
  assert.ok(p.includes('6. 若判断不值得编译,简短说明并结束'))
})

// ── 编译小结契约(ADR-0024):动作+文件+理由,wikilink 引用,≤80 字 ──

test('buildIngestPrompt: 第 7 步编译小结契约(要素+wikilink+长度)', () => {
  const p = buildIngestPrompt('x.md')
  assert.ok(p.includes('编译小结'), '应含术语「编译小结」')
  assert.ok(p.includes('≤80 字'), '应含长度约束')
  assert.ok(p.includes('[[NN-主题]]'), '应指示 wikilink 引用 wiki/output 文章')
  assert.ok(p.includes('新建/合并/更新/未编译'), '应列动作要素')
})
