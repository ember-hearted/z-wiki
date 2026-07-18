// 回归测试:relayEvent 提取为纯函数后,现有 text_delta/tool/agent_end 转发行为零变化。
// 注入 mock socket(收集 send)+ mock ctx(getStats/triggerBuild),断言 WS 帧。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relayEvent, type RelayCtx } from './relayEvent.js'

/** 收集 socket.send 调用,返回 socket 与已发帧字符串数组。 */
function mockSocket() {
  const sent: string[] = []
  const socket = { send: (s: string) => sent.push(s) }
  return { socket, sent }
}

const noopCtx: RelayCtx = { getStats: () => undefined, triggerBuild: () => {} }

test('message_update 的 text_delta 转发为 text_delta 帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'text_delta', text: 'hi' }],
  )
})

test('message_update 的 text_delta 无 delta 不发帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta' } },
    noopCtx,
  )
  assert.equal(sent.length, 0)
})

test('message_update 的 thinking_start 转发为 thinking_start 帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'thinking_start' }],
  )
})

test('message_update 的 thinking_delta 转发为 thinking_delta 帧(delta -> text)', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '正在想' } },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'thinking_delta', text: '正在想' }],
  )
})

test('message_update 的 thinking_end 转发为 thinking_end 帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'thinking_end' }],
  )
})

test('message_update 的 text_end 等非转发事件不发帧(text_start/text_end/toolcall_* 仍不转发)', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'message_update', assistantMessageEvent: { type: 'text_end' } },
    noopCtx,
  )
  assert.equal(sent.length, 0)
})

test('tool_execution_start 转发为 tool_start 帧(带 tool + args)', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'tool_execution_start', toolName: 'read', args: { file_path: 'a.md' } },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'tool_start', tool: 'read', args: { file_path: 'a.md' } }],
  )
})

test('tool_execution_end 无 isError -> error:false', () => {
  const { socket, sent } = mockSocket()
  relayEvent(socket, { type: 'tool_execution_end', toolName: 'read' }, noopCtx)
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'tool_end', tool: 'read', error: false }],
  )
})

test('tool_execution_end 有 isError -> error:true', () => {
  const { socket, sent } = mockSocket()
  relayEvent(socket, { type: 'tool_execution_end', toolName: 'read', isError: true }, noopCtx)
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'tool_end', tool: 'read', error: true }],
  )
})

test('agent_end 有 stats -> done 帧带 stats + 触发 triggerBuild', () => {
  const { socket, sent } = mockSocket()
  const stats = { tokens: { input: 1, output: 2, total: 3 }, cost: 0, contextUsage: null }
  let buildCalled = false
  relayEvent(
    socket,
    { type: 'agent_end' },
    {
      getStats: () => stats,
      triggerBuild: () => {
        buildCalled = true
      },
    },
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'done', stats }],
  )
  assert.equal(buildCalled, true)
})

test('agent_end 无 stats(无 session)-> 裸 done 帧 + 仍触发 triggerBuild', () => {
  const { socket, sent } = mockSocket()
  let buildCalled = false
  relayEvent(
    socket,
    { type: 'agent_end' },
    {
      ...noopCtx,
      triggerBuild: () => {
        buildCalled = true
      },
    },
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'done' }],
  )
  assert.equal(buildCalled, true)
})

test('未知事件类型不发帧(默认忽略)', () => {
  const { socket, sent } = mockSocket()
  relayEvent(socket, { type: 'something_else' }, noopCtx)
  assert.equal(sent.length, 0)
})

test('agent_end 最终失败的 assistant 消息 -> error 帧(在 done 前)透传 errorMessage', () => {
  // stream 报错(如 provider 400)时 assistant 消息为空,若无 error 帧前端只收 done → 静默无渲染。
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    {
      type: 'agent_end',
      messages: [
        { role: 'user' },
        { role: 'assistant', stopReason: 'error', errorMessage: '400 bad request' },
      ],
    },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'error', text: '400 bad request' }, { type: 'done' }],
  )
})

test('agent_end error 缺 errorMessage -> 兜底文案', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'error' }] },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'error', text: 'LLM 请求失败' }, { type: 'done' }],
  )
})

test('agent_end willRetry=true(pi 自动重试中)-> 不发 error 帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    {
      type: 'agent_end',
      willRetry: true,
      messages: [{ role: 'assistant', stopReason: 'error', errorMessage: '429 rate limit' }],
    },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'done' }],
  )
})

test('agent_end assistant 正常结束(stopReason=stop)-> 不发 error 帧', () => {
  const { socket, sent } = mockSocket()
  relayEvent(
    socket,
    { type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] },
    noopCtx,
  )
  assert.deepEqual(
    sent.map((s) => JSON.parse(s)),
    [{ type: 'done' }],
  )
})
