// configReload.test.ts - 冷重载编排单测(Interaction sibling helper,类比 relayEvent.test.ts)。
// 把 POST /api/config/llm 的"写 config -> reload -> apply"编排外提后,隔离测(mock agentCtx + mock sessions):
// 成功路径 + 双失败路径(reload 失败 stage='reload' / apply 失败 stage='apply')。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { reloadLlmConfig, ConfigReloadError, type ReloadDeps } from './configReload.js'
import type { AgentContext } from './agentHost.js'

const mkTempDirs = async (): Promise<{ tmp: string; agentDir: string; configPath: string }> => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-reload-'))
  const agentDir = path.join(tmp, '.pi/agent')
  await fs.mkdir(agentDir, { recursive: true })
  const configPath = path.join(tmp, 'config.json')
  await fs.writeFile(
    configPath,
    JSON.stringify({
      apiKey: 'old-key',
      baseUrl: 'https://h/v1',
      api: 'openai-completions',
      model: 'old-model',
    }),
    'utf-8',
  )
  return { tmp, agentDir, configPath }
}

/** mock AgentContext:modelRuntime/modelRegistry spy,find 返回 mockModel 或 undefined;agentDir 真实(writeModelsJson 落盘)。 */
const mkMockCtx = (
  agentDir: string,
  findModel: Model<Api> | undefined,
): {
  ctx: AgentContext
  refreshCalls: number[]
  setKeyCalls: Array<{ provider: string; key: string }>
} => {
  const refreshCalls: number[] = []
  const setKeyCalls: Array<{ provider: string; key: string }> = []
  const ctx = {
    agentDir,
    appRoot: path.dirname(path.dirname(agentDir)),
    config: {
      apiKey: 'old-key',
      baseUrl: 'https://h/v1',
      api: 'openai-completions',
      model: 'old-model',
    },
    modelRuntime: {
      setRuntimeApiKey: async (provider: string, key: string) =>
        setKeyCalls.push({ provider, key }),
    },
    modelRegistry: {
      refresh: async () => {
        refreshCalls.push(1)
      },
      find: () => findModel,
    },
  } as unknown as AgentContext
  return { ctx, refreshCalls, setKeyCalls }
}

const mkMockSession = (
  opts: { fail?: boolean } = {},
): { session: AgentSession; setModelCalls: unknown[] } => {
  const setModelCalls: unknown[] = []
  const session = {
    setModel: async (m: unknown) => {
      setModelCalls.push(m)
      if (opts.fail) throw new Error('setModel boom')
    },
  } as unknown as AgentSession
  return { session, setModelCalls }
}

// ── 成功路径 ──────────────────────────────────────────────────────

test('reloadLlmConfig: 成功 -> 写 config + reload(refresh/setKey)+ apply(setModel),返回 model', async () => {
  const { tmp, agentDir, configPath } = await mkTempDirs()
  try {
    const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
    const { ctx, refreshCalls, setKeyCalls } = mkMockCtx(agentDir, mockModel)
    const { session, setModelCalls } = mkMockSession()
    const deps: ReloadDeps = { configPath, agentCtx: ctx, getSessions: () => [session] }

    const result = await reloadLlmConfig(deps, (cfg) => ({
      ...cfg,
      model: 'gpt-4o',
      apiKey: 'new-key',
    }))

    assert.equal(result, mockModel, '应返回 resolveModel 找到的新 model')
    // config 写盘(mutator 改了 model/apiKey)
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      model: string
      apiKey: string
    }
    assert.equal(onDisk.model, 'gpt-4o')
    assert.equal(onDisk.apiKey, 'new-key')
    // reload: refresh 一次 + setRuntimeApiKey 用新 key
    assert.equal(refreshCalls.length, 1)
    assert.deepEqual(setKeyCalls, [{ provider: 'custom', key: 'new-key' }])
    // apply: session.setModel 被调,传入 mockModel
    assert.equal(setModelCalls.length, 1)
    assert.equal(setModelCalls[0], mockModel)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

// ── reload 失败(model 找不到)──────────────────────────────────────

test('reloadLlmConfig: reload 失败 -> 抛 ConfigReloadError(stage=reload),config 已写、apply 未执行', async () => {
  const { tmp, agentDir, configPath } = await mkTempDirs()
  try {
    const { ctx, refreshCalls } = mkMockCtx(agentDir, undefined) // find 返回 undefined -> resolveModel 抛
    const { session, setModelCalls } = mkMockSession()
    const deps: ReloadDeps = { configPath, agentCtx: ctx, getSessions: () => [session] }

    await assert.rejects(
      () => reloadLlmConfig(deps, (cfg) => ({ ...cfg, model: 'unknown' })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigReloadError, '应为 ConfigReloadError')
        assert.equal(err.stage, 'reload')
        assert.match(err.reason.message, /模型未找到/)
        assert.match(err.message, /配置已保存但重载失败/, '错误信息应含"已保存但重载失败"')
        return true
      },
    )
    // config 已写(updateConfig 在 reload 之前)
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { model: string }
    assert.equal(onDisk.model, 'unknown')
    // refresh 被调(reload 走到 refresh 后才在 resolveModel 抛)
    assert.equal(refreshCalls.length, 1)
    // apply 未执行(reload 抛 -> 跳过 apply)
    assert.equal(setModelCalls.length, 0)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

// ── apply 失败(setModel 抛)───────────────────────────────────────

test('reloadLlmConfig: apply 失败 -> 抛 ConfigReloadError(stage=apply),config 已写、reload 已成', async () => {
  const { tmp, agentDir, configPath } = await mkTempDirs()
  try {
    const mockModel = { id: 'gpt-4o' } as unknown as Model<Api>
    const { ctx, refreshCalls } = mkMockCtx(agentDir, mockModel) // reload 成功
    const { session, setModelCalls } = mkMockSession({ fail: true }) // setModel 抛
    const deps: ReloadDeps = { configPath, agentCtx: ctx, getSessions: () => [session] }

    await assert.rejects(
      () => reloadLlmConfig(deps, (cfg) => ({ ...cfg, model: 'gpt-4o' })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigReloadError, '应为 ConfigReloadError')
        assert.equal(err.stage, 'apply')
        assert.match(err.reason.message, /setModel boom/)
        assert.match(err.message, /配置已保存且重载成功/, '错误信息应含"已保存且重载成功"')
        return true
      },
    )
    // config 已写 + reload 已成(refresh 调过)
    const onDisk = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { model: string }
    assert.equal(onDisk.model, 'gpt-4o')
    assert.equal(refreshCalls.length, 1)
    // apply 尝试了(setModel 被调后抛)
    assert.equal(setModelCalls.length, 1)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
