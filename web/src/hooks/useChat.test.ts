// 回归测试:applyServerMsg 提取为纯函数后,现有 text_delta/tool_start/tool_end/done/error 行为零变化。
// 注入 mock ctx(nextId 固定)+ current(streamingId/prevTokens),断言返回的更新。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyServerMsg, type ChatMessage } from './useChat.js'

const ctx = { nextId: () => 's1' }

test('text_delta 续写末段 text', () => {
  const update = applyServerMsg({ type: 'text_delta', text: 'hi' }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  const prev: ChatMessage[] = [
    { id: 'a1', role: 'assistant', segments: [{ kind: 'text', id: 't1', text: 'pre' }] },
  ]
  assert.deepEqual(update?.messages?.(prev), [
    { id: 'a1', role: 'assistant', segments: [{ kind: 'text', id: 't1', text: 'prehi' }] },
  ])
})

test('text_delta 末段非 text -> 新建 text 段', () => {
  const update = applyServerMsg({ type: 'text_delta', text: 'hi' }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  const prev: ChatMessage[] = [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'done' }],
    },
  ]
  assert.deepEqual(update?.messages?.(prev), [
    {
      id: 'a1',
      role: 'assistant',
      segments: [
        { kind: 'tool', id: 't1', tool: 'read', status: 'done' },
        { kind: 'text', id: 's1', text: 'hi' },
      ],
    },
  ])
})

test('text_delta 无 streamingId -> messages 不变', () => {
  const update = applyServerMsg({ type: 'text_delta', text: 'hi' }, ctx, {
    streamingId: null,
    prevTokens: null,
  })
  const prev: ChatMessage[] = [{ id: 'a1', role: 'assistant', segments: [] }]
  assert.deepEqual(update?.messages?.(prev), prev)
})

test('tool_start 追加 running 工具段', () => {
  const update = applyServerMsg(
    { type: 'tool_start', tool: 'read', args: { file_path: 'a.md' } },
    ctx,
    { streamingId: 'a1', prevTokens: null },
  )
  const prev: ChatMessage[] = [{ id: 'a1', role: 'assistant', segments: [] }]
  assert.deepEqual(update?.messages?.(prev), [
    {
      id: 'a1',
      role: 'assistant',
      segments: [
        { kind: 'tool', id: 's1', tool: 'read', status: 'running', args: { file_path: 'a.md' } },
      ],
    },
  ])
})

test('tool_start 无 streamingId -> 空 update(不崩)', () => {
  const update = applyServerMsg({ type: 'tool_start', tool: 'read' }, ctx, {
    streamingId: null,
    prevTokens: null,
  })
  assert.deepEqual(update, {})
})

test('tool_end 配对最近同名 running -> done', () => {
  const update = applyServerMsg({ type: 'tool_end', tool: 'read' }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  const prev: ChatMessage[] = [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'running' }],
    },
  ]
  assert.deepEqual(update?.messages?.(prev), [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'done' }],
    },
  ])
})

test('tool_end isError -> error', () => {
  const update = applyServerMsg({ type: 'tool_end', tool: 'read', error: true }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  const prev: ChatMessage[] = [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'running' }],
    },
  ]
  assert.deepEqual(update?.messages?.(prev), [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'error' }],
    },
  ])
})

test('tool_end 无配对 running -> messages 不变', () => {
  const update = applyServerMsg({ type: 'tool_end', tool: 'read' }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  const prev: ChatMessage[] = [
    {
      id: 'a1',
      role: 'assistant',
      segments: [{ kind: 'tool', id: 't1', tool: 'read', status: 'done' }],
    },
  ]
  assert.deepEqual(update?.messages?.(prev), prev)
})

test('done 无 stats -> streaming false + streamingId null,无 stats 字段', () => {
  const update = applyServerMsg({ type: 'done' }, ctx, { streamingId: 'a1', prevTokens: null })
  assert.equal(update?.streaming, false)
  assert.equal(update?.streamingId, null)
  assert.equal(update?.turnStats, undefined)
  assert.equal(update?.prevTokens, undefined)
  assert.equal(update?.contextUsage, undefined)
})

test('done 有 stats 首次(无 prev)-> turnStats=cur + prevTokens=cur + contextUsage', () => {
  const stats = {
    tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, total: 17 },
    cost: 0,
    contextUsage: { tokens: 10, contextWindow: 1000, percent: 1 },
  }
  const update = applyServerMsg({ type: 'done', stats }, ctx, {
    streamingId: 'a1',
    prevTokens: null,
  })
  assert.deepEqual(update?.turnStats, { input: 10, output: 5, cacheRead: 2 })
  assert.deepEqual(update?.prevTokens, stats.tokens)
  assert.deepEqual(update?.contextUsage, stats.contextUsage)
})

test('done 有 stats 二次(有 prev)-> turnStats=差值', () => {
  const stats = {
    tokens: { input: 30, output: 15, cacheRead: 8, cacheWrite: 0, total: 53 },
    cost: 0,
    contextUsage: null,
  }
  const prevTokens = { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, total: 17 }
  const update = applyServerMsg({ type: 'done', stats }, ctx, {
    streamingId: 'a1',
    prevTokens,
  })
  assert.deepEqual(update?.turnStats, { input: 20, output: 10, cacheRead: 6 })
  assert.deepEqual(update?.prevTokens, stats.tokens)
  assert.deepEqual(update?.contextUsage, null)
})

test('error 加 system 消息 + streaming false + streamingId null', () => {
  const update = applyServerMsg(
    { type: 'error', text: 'boom' },
    { nextId: () => 'e1' },
    {
      streamingId: 'a1',
      prevTokens: null,
    },
  )
  const prev: ChatMessage[] = []
  assert.deepEqual(update?.messages?.(prev), [
    { id: 'e1', role: 'system', text: 'boom', error: true },
  ])
  assert.equal(update?.streaming, false)
  assert.equal(update?.streamingId, null)
})

test('未知类型(kb_updated)-> null(由 hook 处理)', () => {
  const update = applyServerMsg({ type: 'kb_updated', total: 5 }, ctx, {
    streamingId: null,
    prevTokens: null,
  })
  assert.equal(update, null)
})

test('未知类型(session_init)-> null', () => {
  const update = applyServerMsg({ type: 'session_init' }, ctx, {
    streamingId: null,
    prevTokens: null,
  })
  assert.equal(update, null)
})
