import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mdToHtml, splitBlocks } from './markdown.js'

// 一致性不变式:整体 mdToHtml(text) == 各块 mdToHtml(block.text) 再 join('\n')。
// 块边界必须与 mdToHtml 的块扫描一致,否则缓存 key 错位、done 后渲染不一致。
function assertConsistent(text: string): void {
  const rejoined = splitBlocks(text)
    .map((b) => mdToHtml(b.text))
    .join('\n')
  assert.equal(rejoined, mdToHtml(text), `一致性失败,原文:\n${JSON.stringify(text)}`)
}

test('splitBlocks 一致性:段落/标题/列表/代码块/引用/表格/hr 混合', () => {
  assertConsistent(
    '# 标题\n\n段落一,含 **加粗** 与 `code`。\n\n- 列表 A\n- 列表 B\n\n```ts\nconst x = 1\n```\n\n> 引用块\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n尾部段落',
  )
})

test('splitBlocks 一致性:未闭合代码块(流式中途)', () => {
  assertConsistent('前文段落\n\n```\nunclosed code')
})

test('splitBlocks 一致性:单行 |(未完成表格,曾触发 mdToHtml 死循环)', () => {
  assertConsistent('| header')
  assertConsistent('| 看起来像表格其实不是\n\n正文')
})

test('splitBlocks 一致性:混序列表(- 与 1. 交替)', () => {
  assertConsistent('- a\n1. b\n- c')
})

test('splitBlocks 一致性:纯文本无块标记', () => {
  assertConsistent('只是一段普通文字,没有任何 markdown 语法。')
})

test('splitBlocks 一致性:空字符串与纯空行', () => {
  assertConsistent('')
  assertConsistent('\n\n')
})

test('splitBlocks 一致性:软换行段落(单换行不分行)', () => {
  assertConsistent('第一行\n第二行\n第三行')
})

test('splitBlocks complete/partial:末尾段落无空行 = partial,前面 complete', () => {
  const blocks = splitBlocks('para1\n\npara2')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].complete, true)
  assert.equal(blocks[1].complete, false)
})

test('splitBlocks complete/partial:末尾有空行 = 全 complete', () => {
  const blocks = splitBlocks('para1\n\npara2\n\n')
  assert.equal(blocks[0].complete, true)
  assert.equal(blocks[1].complete, true)
})

test('splitBlocks complete/partial:闭合代码块 = complete', () => {
  const blocks = splitBlocks('```\ncode\n```')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].complete, true)
})

test('splitBlocks complete/partial:未闭合代码块 = partial', () => {
  const blocks = splitBlocks('```\ncode')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].complete, false)
})

test('splitBlocks complete/partial:代码块后接段落,代码 complete 段落 partial', () => {
  const blocks = splitBlocks('```\ncode\n```\n\n尾段')
  assert.equal(blocks[0].complete, true)
  assert.equal(blocks[1].complete, false)
})

test('splitBlocks 块类型:标题块原文', () => {
  const blocks = splitBlocks('# H1\n\n正文')
  assert.equal(blocks[0].text, '# H1')
})

test('splitBlocks 块类型:hr 块原文', () => {
  const blocks = splitBlocks('---\n\n正文')
  assert.equal(blocks[0].text, '---')
})
