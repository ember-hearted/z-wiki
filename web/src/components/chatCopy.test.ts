import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLastTextSegment } from './chatCopy.js'
import type { Segment } from '../hooks/useChat.js'

const text = (id: string, t: string): Segment => ({ kind: 'text', id, text: t })
const tool = (id: string): Segment => ({ kind: 'tool', id, tool: 'x', status: 'done' })
const thinking = (id: string): Segment => ({
  kind: 'thinking',
  id,
  text: '',
  collapsed: true,
  streaming: false,
})

test('getLastTextSegment: 空数组 -> null', () => {
  assert.equal(getLastTextSegment([]), null)
})

test('getLastTextSegment: 无 text 段(全 tool/thinking)-> null', () => {
  assert.equal(getLastTextSegment([tool('1'), thinking('2')]), null)
})

test('getLastTextSegment: 单 text 段 -> 该段', () => {
  const seg = text('1', 'hello')
  assert.equal(getLastTextSegment([seg]), seg)
})

test('getLastTextSegment: 多 text 段(穿插 tool/thinking)-> 最后一个 text', () => {
  const a = text('1', 'a')
  const b = text('3', 'b')
  const c = text('5', 'c')
  assert.equal(getLastTextSegment([a, tool('2'), b, thinking('4'), c]), c)
})

test('getLastTextSegment: text 在中间、末尾是 tool -> 中间那个 text', () => {
  const a = text('1', 'a')
  const b = text('2', 'b')
  assert.equal(getLastTextSegment([a, b, tool('3')]), b)
})
