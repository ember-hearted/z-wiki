// ingestSummary.test.ts - 编译小结收集器单测(ADR-0024)。
// 锁定行为:text_delta 拼接、message_start(assistant) 重置只留收尾消息、
// 非 assistant message_start 不重置、无文本时 text() 为 ''(调用方回退模板)。

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectClosingText } from './ingestSummary.js'

const textDelta = (delta: string) => ({
  type: 'message_update',
  assistantMessageEvent: { type: 'text_delta', delta },
})

test('collectClosingText: 单条 assistant 消息的 text_delta 拼接', () => {
  const c = collectClosingText()
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent(textDelta('已合并到 '))
  c.onEvent(textDelta('[[09-AG-UI-架构]]'))
  assert.equal(c.text(), '已合并到 [[09-AG-UI-架构]]')
})

test('collectClosingText: 新 assistant 消息重置,只留收尾消息(过渡文本丢弃)', () => {
  const c = collectClosingText()
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent(textDelta('我先读取文件'))
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent(textDelta('已新建 [[10-foo]]'))
  assert.equal(c.text(), '已新建 [[10-foo]]')
})

test('collectClosingText: 非 assistant 的 message_start 不重置', () => {
  const c = collectClosingText()
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent(textDelta('收尾'))
  c.onEvent({ type: 'message_start', message: { role: 'user' } })
  assert.equal(c.text(), '收尾')
})

test('collectClosingText: 非 text_delta 事件忽略(thinking_delta/工具事件不混入)', () => {
  const c = collectClosingText()
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'thinking_delta', delta: '嗯' },
  })
  c.onEvent({ type: 'tool_execution_start', toolName: 'write' })
  c.onEvent(textDelta('小结'))
  assert.equal(c.text(), '小结')
})

test('collectClosingText: agent 未产出文本(全程只调工具)-> text() 为空串', () => {
  const c = collectClosingText()
  c.onEvent({ type: 'message_start', message: { role: 'assistant' } })
  c.onEvent({ type: 'tool_execution_start', toolName: 'write' })
  assert.equal(c.text(), '')
})
