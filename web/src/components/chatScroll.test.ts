import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldScrollToBottom } from './chatScroll.js'

test('新消息增长 -> 滚', () => {
  assert.equal(shouldScrollToBottom(2, 3, false, false), true)
})

test('流式中 delta(同长度) -> 滚', () => {
  assert.equal(shouldScrollToBottom(3, 3, true, true), true)
})

test('流开始(同长度,false->true) -> 滚', () => {
  assert.equal(shouldScrollToBottom(3, 3, false, true), true)
})

test('流结束(同长度,true->false) -> 滚(收尾)', () => {
  assert.equal(shouldScrollToBottom(3, 3, true, false), true)
})

test('toggle 胶囊(同长度、非流式) -> 不滚', () => {
  assert.equal(shouldScrollToBottom(3, 3, false, false), false)
})

test('初始无消息 -> 不滚', () => {
  assert.equal(shouldScrollToBottom(0, 0, false, false), false)
})
