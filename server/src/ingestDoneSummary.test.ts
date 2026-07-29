// ingestDoneSummary.test.ts - 编译小结端到端契约(ADR-0024)。
// mock ingest session 在 prompt 内经 opts.onEvent 发 pi 事件(message_start + text_delta),
// 验证两条 ingest 路径的 ingest_done 广播都带 summary 字段;
// /api/ingest 路径额外验证 HTTP response 复用同一小结文本。

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from './index.js'
import { CONFIG_JSON, makeVault } from './testFixtures.js'

process.env.NODE_ENV = 'production'
process.env.LOG_LEVEL = 'error'

/** 构造单文件字段 multipart body(复用 upload.test.ts 的形态)。 */
function multipart(boundary: string, filename: string, content: string): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: application/octet-stream',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

const mockStats = () => ({
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
  contextUsage: null,
})

const mockCreateChatSession = async () => ({
  prompt: async () => {},
  dispose: () => {},
  getSessionStats: mockStats,
  setModel: async () => {},
  thinkingLevel: 'off' as const,
  setThinkingLevel: () => {},
})

/** mock ingest session:prompt 时经 onEvent 发"过渡文本 + 新消息 + 收尾文本",模拟 agent 真实事件流。 */
const SUMMARY = '已合并到 [[09-AG-UI-架构]],事件体系扩为完整规范'
const mockCreateIngestSession = async (opts: { onEvent: (event: unknown) => void }) => ({
  prompt: async () => {
    opts.onEvent({ type: 'message_start', message: { role: 'assistant' } })
    opts.onEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '过渡' },
    })
    opts.onEvent({ type: 'message_start', message: { role: 'assistant' } })
    opts.onEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: SUMMARY },
    })
  },
  dispose: () => {},
  getSessionStats: mockStats,
  setModel: async () => {},
})

/** 连 WS 等满足条件的广播消息(超时 reject)。 */
function waitForBroadcast(
  port: number,
  match: (msg: Record<string, unknown>) => boolean,
  onOpen?: () => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('等待广播超时'))
    }, 5000)
    ws.onopen = () => {
      // 等 session_init 注册进 chatSessions 后再触发动作(否则 broadcast 无人收)
      setTimeout(() => onOpen?.(), 200)
    }
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
        if (match(msg)) {
          clearTimeout(timer)
          ws.close()
          resolve(msg)
        }
      } catch {
        /* 非 JSON 帧忽略 */
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('WS 连接失败'))
    }
  })
}

test('上传路径: ingest_done 广播带编译小结(agent 收尾文本)', async () => {
  const vault = await makeVault()
  const interaction = await createServer({
    kbRoot: vault.kbRoot,
    agentDir: vault.agentDir,
    sessions: {
      createChatSession: mockCreateChatSession as never,
      createIngestSession: mockCreateIngestSession as never,
    },
  })
  try {
    await interaction.app.listen({ port: 0, host: '127.0.0.1' })
    const address = interaction.app.server.address()
    const port = typeof address === 'object' && address ? address.port : null
    if (!port) throw new Error('listen 未拿到端口')

    const done = await waitForBroadcast(
      port,
      (m) => m.type === 'ingest_done',
      () => {
        void interaction.app.inject({
          method: 'POST',
          url: '/api/upload',
          headers: { 'content-type': 'multipart/form-data; boundary=b' },
          payload: multipart('b', 'ag-ui.md', '# AG-UI\n\n内容\n'),
        })
      },
    )
    assert.equal(done.raw, 'ag-ui.md')
    // 只留收尾消息文本,过渡文本被 message_start 重置丢弃
    assert.equal(done.summary, SUMMARY)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('/api/ingest 路径: response 与 ingest_done 广播共用同一编译小结', async () => {
  const vault = await makeVault()
  // A2A 收件开关写 config.preferences.a2aEnabled(POST /api/ingest 的守卫)
  await fs.writeFile(
    path.join(vault.root, 'config.json'),
    JSON.stringify({ ...CONFIG_JSON, preferences: { a2aEnabled: true } }),
    'utf-8',
  )
  const interaction = await createServer({
    kbRoot: vault.kbRoot,
    agentDir: vault.agentDir,
    sessions: {
      createChatSession: mockCreateChatSession as never,
      createIngestSession: mockCreateIngestSession as never,
    },
  })
  try {
    await interaction.app.listen({ port: 0, host: '127.0.0.1' })
    const address = interaction.app.server.address()
    const port = typeof address === 'object' && address ? address.port : null
    if (!port) throw new Error('listen 未拿到端口')

    let responsePayload: { raw: string; response: string } | null = null
    const done = await waitForBroadcast(
      port,
      (m) => m.type === 'ingest_done',
      () => {
        void interaction.app
          .inject({
            method: 'POST',
            url: '/api/ingest',
            payload: { content: '# AG-UI 事件规范', source: 'claude-code', title: 'ag-ui' },
          })
          .then((res) => {
            responsePayload = res.json() as { raw: string; response: string }
          })
      },
    )
    assert.equal(done.summary, SUMMARY)
    assert.equal(done.source, 'claude-code')
    // HTTP response 与广播共用同一小结文本(responseText 语义从全程拼接明确为收尾消息)
    assert.ok(responsePayload, '应拿到 /api/ingest 响应')
    assert.equal((responsePayload as { response: string }).response, SUMMARY)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})
