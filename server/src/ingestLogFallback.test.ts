// ingestLogFallback.test.ts - ingest 日志兜底(ADR-0025)。
// 单测:buildFallbackEntry 条目格式 / appendIngestLogIfUntouched 的 mtime 三分支;
// 集成:两条 ingest 路径,mock agent 漏记 log.md -> server 补记(含编译小结),守约亲写 -> 不补。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createServer } from './index.js'
import {
  appendIngestLogIfUntouched,
  buildFallbackEntry,
  snapshotLogMtime,
} from './ingestLogFallback.js'
import { CONFIG_JSON, makeVault } from './testFixtures.js'

process.env.NODE_ENV = 'production'
process.env.LOG_LEVEL = 'error'

// ── 单测:buildFallbackEntry 条目格式 ─────────────────────────────

test('buildFallbackEntry: §5 模板格式(日期/标题/操作标注/涉及文件/摘要)', () => {
  const entry = buildFallbackEntry('ag-ui.md', '已合并到 [[09-AG-UI-架构]]', new Date(2026, 6, 29))
  assert.ok(entry.includes('## [2026-07-29] ingest | ag-ui.md'))
  assert.ok(entry.includes('- **操作**: ingest(server 补记)'))
  assert.ok(entry.includes('- **涉及文件**: raw/ag-ui.md (source)'))
  assert.ok(entry.includes('- **摘要**: 已合并到 [[09-AG-UI-架构]]'))
})

test('buildFallbackEntry: 空小结 -> 兜底文案', () => {
  const entry = buildFallbackEntry('x.md', '  ', new Date(2026, 6, 29))
  assert.ok(entry.includes('编译完成(agent 未产出编译小结)'))
})

test('buildFallbackEntry: 月份/日期补零', () => {
  const entry = buildFallbackEntry('x.md', 's', new Date(2026, 0, 5))
  assert.ok(entry.includes('## [2026-01-05]'))
})

// ── 单测:appendIngestLogIfUntouched mtime 三分支 ──────────────────

test('appendIngestLogIfUntouched: mtime 未变(agent 漏记)-> 追加补记条目', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-logfb-'))
  try {
    const logPath = path.join(root, 'log.md')
    await fs.writeFile(logPath, '# 日志\n', 'utf-8')
    const before = await snapshotLogMtime(root)
    const appended = await appendIngestLogIfUntouched(root, before, 'ag-ui.md', '小结文本')
    assert.equal(appended, true)
    const content = await fs.readFile(logPath, 'utf-8')
    assert.ok(content.includes('ingest(server 补记)'))
    assert.ok(content.includes('小结文本'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('appendIngestLogIfUntouched: mtime 已变(agent 守约)-> 不动作', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-logfb-'))
  try {
    const logPath = path.join(root, 'log.md')
    await fs.writeFile(logPath, '# 日志\n', 'utf-8')
    const before = await snapshotLogMtime(root)
    // 模拟 agent 在 ingest 期间亲写 log.md(mtime 变化)
    await fs.appendFile(logPath, '\n## [2026-07-29] ingest | agent 亲写\n', 'utf-8')
    const appended = await appendIngestLogIfUntouched(root, before, 'ag-ui.md', '小结文本')
    assert.equal(appended, false)
    const content = await fs.readFile(logPath, 'utf-8')
    assert.ok(!content.includes('server 补记'), 'agent 守约时不应有补记条目')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('appendIngestLogIfUntouched: log.md 不存在(前后皆 null)-> 创建并写入条目', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-logfb-'))
  try {
    const before = await snapshotLogMtime(root)
    assert.equal(before, null)
    const appended = await appendIngestLogIfUntouched(root, before, 'ag-ui.md', '小结文本')
    assert.equal(appended, true)
    const content = await fs.readFile(path.join(root, 'log.md'), 'utf-8')
    assert.ok(content.includes('ingest(server 补记)'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

// ── 集成:两条 ingest 路径的端到端兜底 ────────────────────────────

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

const SUMMARY = '已合并到 [[09-AG-UI-架构]]'

/** mock ingest session:发收尾文本;writeLog=true 时模拟 agent 守约亲写 log.md。 */
const makeMockIngest =
  (writeLog: boolean) => async (opts: { kbRoot: string; onEvent: (event: unknown) => void }) => ({
    prompt: async () => {
      if (writeLog) {
        await fs.appendFile(
          path.join(opts.kbRoot, 'log.md'),
          '\n## [2026-07-29] ingest | agent 亲写\n',
          'utf-8',
        )
      }
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

/** 起 server + WS,上传一个文件,等 ingest_done 后返回 log.md 内容。 */
async function uploadAndReadLog(
  kbRoot: string,
  interaction: Awaited<ReturnType<typeof createServer>>,
  port: number,
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('等待 ingest_done 超时'))
    }, 5000)
    ws.onopen = () => {
      setTimeout(() => {
        void interaction.app.inject({
          method: 'POST',
          url: '/api/upload',
          headers: { 'content-type': 'multipart/form-data; boundary=b' },
          payload: multipart('b', 'ag-ui.md', '# AG-UI\n\n内容\n'),
        })
      }, 200)
    }
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string }
        if (msg.type === 'ingest_done') {
          clearTimeout(timer)
          ws.close()
          resolve()
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
  return fs.readFile(path.join(kbRoot, 'log.md'), 'utf-8')
}

async function startServer(
  vault: Awaited<ReturnType<typeof makeVault>>,
  mockIngest: ReturnType<typeof makeMockIngest>,
) {
  const interaction = await createServer({
    kbRoot: vault.kbRoot,
    agentDir: vault.agentDir,
    sessions: {
      createChatSession: mockCreateChatSession as never,
      createIngestSession: mockIngest as never,
    },
  })
  await interaction.app.listen({ port: 0, host: '127.0.0.1' })
  const address = interaction.app.server.address()
  const port = typeof address === 'object' && address ? address.port : null
  if (!port) throw new Error('listen 未拿到端口')
  return { interaction, port }
}

test('集成: 上传后 agent 漏记 log.md -> server 兜底补记(摘要=编译小结)', async () => {
  const vault = await makeVault()
  const { interaction, port } = await startServer(vault, makeMockIngest(false))
  try {
    const log = await uploadAndReadLog(vault.kbRoot, interaction, port)
    assert.ok(log.includes('ingest(server 补记)'), `应有补记条目,实际:\n${log}`)
    assert.ok(log.includes(SUMMARY), '补记摘要应复用编译小结')
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('集成: 上传后 agent 守约亲写 log.md -> server 不补记', async () => {
  const vault = await makeVault()
  const { interaction, port } = await startServer(vault, makeMockIngest(true))
  try {
    const log = await uploadAndReadLog(vault.kbRoot, interaction, port)
    assert.ok(log.includes('agent 亲写'))
    assert.ok(!log.includes('server 补记'), `守约时不应有补记条目,实际:\n${log}`)
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})

test('集成: /api/ingest 漏记 -> server 兜底补记', async () => {
  const vault = await makeVault()
  await fs.writeFile(
    path.join(vault.root, 'config.json'),
    JSON.stringify({ ...CONFIG_JSON, preferences: { a2aEnabled: true } }),
    'utf-8',
  )
  const { interaction } = await startServer(vault, makeMockIngest(false))
  try {
    const res = await interaction.app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { content: '# AG-UI 事件规范', source: 'claude-code', title: 'ag-ui' },
    })
    assert.equal(res.statusCode, 200)
    const log = await fs.readFile(path.join(vault.kbRoot, 'log.md'), 'utf-8')
    assert.ok(log.includes('ingest(server 补记)'), `应有补记条目,实际:\n${log}`)
    assert.ok(log.includes(SUMMARY), '补记摘要应复用编译小结')
  } finally {
    await interaction.app.close()
    await fs.rm(vault.root, { recursive: true, force: true })
  }
})
