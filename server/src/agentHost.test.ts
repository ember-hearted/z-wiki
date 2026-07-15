import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  reloadAgentConfig,
  applyModelToSessions,
  updateConfig,
  type AgentContext,
} from './agentHost.js'

const mkTempAgentDir = async (): Promise<{ tmp: string; agentDir: string }> => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-agent-'))
  const agentDir = path.join(tmp, '.pi/agent')
  await fs.mkdir(agentDir, { recursive: true })
  return { tmp, agentDir }
}

/** 构造 mock AgentContext:modelRegistry/authStorage 用 spy,agentDir 真实(验证 writeModelsJson)。 */
const mkMockCtx = (
  agentDir: string,
  opts: { findModel?: Model<Api> | undefined } = {},
): AgentContext => {
  const mockModel = opts.findModel
  return {
    agentDir,
    appRoot: path.dirname(path.dirname(agentDir)),
    config: { apiKey: '', baseUrl: '', api: 'openai-completions', model: '' },
    modelRegistry: {
      refresh: () => {},
      find: () => mockModel,
    },
    authStorage: { setRuntimeApiKey: () => {} },
  } as unknown as AgentContext
}

test('reloadAgentConfig: 写 models.json + refresh + setRuntimeApiKey + 更新 ctx.config + 返回 model', async () => {
  const { tmp, agentDir } = await mkTempAgentDir()
  try {
    const mockModel = { id: 'gpt-4o', provider: 'custom' } as unknown as Model<Api>
    const refreshCalls: number[] = []
    const setKeyCalls: Array<{ provider: string; key: string }> = []
    const ctx = {
      agentDir,
      appRoot: tmp,
      config: { apiKey: '', baseUrl: '', api: 'openai-completions', model: '' },
      modelRegistry: {
        refresh: () => {
          refreshCalls.push(1)
        },
        find: (provider: string, id: string) =>
          provider === 'custom' && id === 'gpt-4o' ? mockModel : undefined,
      },
      authStorage: {
        setRuntimeApiKey: (provider: string, key: string) => setKeyCalls.push({ provider, key }),
      },
    } as unknown as AgentContext

    const config = {
      apiKey: 'new-key',
      baseUrl: 'https://h/v1',
      api: 'openai-completions',
      model: 'gpt-4o',
    }
    const result = await reloadAgentConfig(ctx, config)

    assert.equal(result, mockModel, '应返回 resolveModel 找到的 model')
    assert.equal(refreshCalls.length, 1, 'modelRegistry.refresh 应被调一次')
    assert.deepEqual(
      setKeyCalls,
      [{ provider: 'custom', key: 'new-key' }],
      'setRuntimeApiKey 用 custom + 新 key',
    )
    assert.equal(ctx.config, config, 'ctx.config 应更新为新 config(后续 resolveModel 读最新)')

    // models.json 写入 agentDir(喂给 refresh 重读)
    const onDisk = JSON.parse(await fs.readFile(path.join(agentDir, 'models.json'), 'utf-8'))
    assert.equal(onDisk.providers.custom.models[0].id, 'gpt-4o')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('reloadAgentConfig: model 找不到 → 抛错(resolveModel 不吞)', async () => {
  const { tmp, agentDir } = await mkTempAgentDir()
  try {
    const ctx = mkMockCtx(agentDir, { findModel: undefined })
    const config = {
      apiKey: 'k',
      baseUrl: 'https://h/v1',
      api: 'openai-completions',
      model: 'unknown-model',
    }
    await assert.rejects(() => reloadAgentConfig(ctx, config), /模型未找到/)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('reloadAgentConfig: baseUrl 规范化兜底(generateModelsJson 内调 normalizeBaseUrl)', async () => {
  const { tmp, agentDir } = await mkTempAgentDir()
  try {
    const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
    const ctx = {
      ...mkMockCtx(agentDir, { findModel: mockModel }),
      // 覆盖 find 让它对 gpt-4o 返回 mockModel
      modelRegistry: {
        refresh: () => {},
        find: () => mockModel,
      },
    } as unknown as AgentContext

    // 手编 config 带 suffix(未经 writeConfig 规范化)
    const config = {
      apiKey: 'k',
      baseUrl: 'https://h/v1/chat/completions',
      api: 'openai-completions',
      model: 'gpt-4o',
    }
    await reloadAgentConfig(ctx, config)

    const onDisk = JSON.parse(await fs.readFile(path.join(agentDir, 'models.json'), 'utf-8'))
    assert.equal(
      onDisk.providers.custom.baseUrl,
      'https://h/v1',
      'models.json 的 baseUrl 应被规范化',
    )
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('applyModelToSessions: 遍历所有 session.setModel(每个调一次)', async () => {
  const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
  const setModelCalls: unknown[] = []
  const sessions = Array.from({ length: 3 }, () => ({
    setModel: async (m: unknown) => {
      setModelCalls.push(m)
    },
  })) as unknown as AgentSession[]

  await applyModelToSessions(sessions, mockModel)

  assert.equal(setModelCalls.length, 3)
  for (const call of setModelCalls) {
    assert.equal(call, mockModel)
  }
})

test('applyModelToSessions: setModel 抛错 → reject(不吞,让调用方感知)', async () => {
  const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
  const sessions = [
    {
      setModel: async () => {
        throw new Error('No API key for custom/gpt-4o')
      },
    },
  ] as unknown as AgentSession[]

  await assert.rejects(() => applyModelToSessions(sessions, mockModel), /No API key/)
})

test('applyModelToSessions: 部分失败不中断其他 session(allSettled),失败汇总抛错', async () => {
  const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
  const successCalls: unknown[] = []
  const sessions = [
    {
      setModel: async (m: unknown) => {
        successCalls.push(m)
      },
    },
    {
      setModel: async () => {
        throw new Error('session-2 failed')
      },
    },
    {
      setModel: async (m: unknown) => {
        successCalls.push(m)
      },
    },
  ] as unknown as AgentSession[]

  // 第 2 个失败,但第 1/3 个应仍执行(allSettled 不中断)
  await assert.rejects(() => applyModelToSessions(sessions, mockModel), /session-2 failed/)
  assert.equal(successCalls.length, 2, '失败前后两个 session 仍应 setModel')
  for (const call of successCalls) {
    assert.equal(call, mockModel)
  }
})

// ── updateConfig(configPath, mutator):withFileLock 内 read-modify-write + readback ──

const mkTempConfig = async (): Promise<{ tmp: string; configPath: string }> => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-updcfg-'))
  const configPath = path.join(tmp, 'config.json')
  await fs.writeFile(
    configPath,
    JSON.stringify({
      apiKey: 'k',
      baseUrl: 'https://h/v1',
      api: 'openai-completions',
      model: 'old',
    }),
    'utf-8',
  )
  return { tmp, configPath }
}

test('updateConfig: mutator 写入字段 + 返回 readback 后的 config(含 baseUrl 规范化)', async () => {
  const { tmp, configPath } = await mkTempConfig()
  try {
    const result = await updateConfig(configPath, (cfg) => ({
      ...cfg,
      model: 'gpt-4o',
      baseUrl: 'https://h/v1/chat/completions', // 带 suffix,验证 readback 走 writeConfig 规范化
    }))
    assert.equal(result.model, 'gpt-4o')
    assert.equal(result.baseUrl, 'https://h/v1', 'readback 应是 writeConfig 规范化后的值')
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      model: string
      baseUrl: string
    }
    assert.equal(onDisk.model, 'gpt-4o')
    assert.equal(onDisk.baseUrl, 'https://h/v1')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('updateConfig: mutator 收到当前 disk config(read-modify-write 语义)', async () => {
  const { tmp, configPath } = await mkTempConfig()
  try {
    let seen: string | undefined
    await updateConfig(configPath, (cfg) => {
      seen = cfg.model
      return { ...cfg, model: `${cfg.model}-new` }
    })
    assert.equal(seen, 'old', 'mutator 应收到 readConfig 的当前 disk 值')
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { model: string }
    assert.equal(onDisk.model, 'old-new')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('updateConfig: 同路径并发调用串行化(无 lost update)', async () => {
  const { tmp, configPath } = await mkTempConfig()
  try {
    // A 改 apiKey、B 改 model。串行化下两者都落盘;交错 race 下后写者用 stale 读覆盖先写者字段。
    await Promise.all([
      updateConfig(configPath, (cfg) => ({ ...cfg, apiKey: 'a' })),
      updateConfig(configPath, (cfg) => ({ ...cfg, model: 'b' })),
    ])
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      apiKey: string
      model: string
    }
    assert.equal(onDisk.apiKey, 'a', 'A 的 apiKey 不应被 B 的 stale 读覆盖(串行化)')
    assert.equal(onDisk.model, 'b', 'B 的 model 应落盘')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
