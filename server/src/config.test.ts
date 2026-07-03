import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateModelsJson, readConfig, writeModelsJson, type ConfigJson } from './config.js'

const arkConfig = (overrides: Partial<ConfigJson> = {}): ConfigJson => ({
  apiKey: 'test-key',
  provider: 'ark',
  model: 'ark-code-latest',
  ...overrides,
})

test('generateModelsJson: ark config 产出符合 pi 格式的 models.json', () => {
  const json = generateModelsJson({ provider: 'ark', model: 'ark-code-latest' })
  assert.deepEqual(json, {
    providers: {
      ark: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
        api: 'anthropic-messages',
        models: [{ id: 'ark-code-latest', contextWindow: 128000 }],
      },
    },
  })
})

test('generateModelsJson: model id 从 config 透传(支持未来换模型)', () => {
  const json = generateModelsJson({ provider: 'ark', model: 'ark-code-v2' })
  assert.equal(json.providers.ark.models[0].id, 'ark-code-v2')
})

test('generateModelsJson: 非 ark provider 抛错(首版仅支持 ark)', () => {
  assert.throws(() => generateModelsJson({ provider: 'openai', model: 'gpt-4' }), /首版仅支持 ark/)
})

test('readConfig: 文件不存在 → 明确报错指向 config.example.json', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const missing = path.join(tmp, 'config.json')
    assert.throws(() => readConfig(missing), /配置文件不存在/)
    assert.throws(() => readConfig(missing), /config\.example\.json/)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 缺 apiKey → 报错"agent 不可用"', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ apiKey: '', provider: 'ark', model: 'ark-code-latest' }),
      'utf-8',
    )
    assert.throws(() => readConfig(cfgPath), /缺少 apiKey.*agent 不可用/)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 正常 config → 返回 parsed 对象', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    const full = arkConfig({
      vaults: [{ path: '/some/kb', name: 'work' }],
      currentVault: '/some/kb',
    })
    await fs.writeFile(cfgPath, JSON.stringify(full), 'utf-8')
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.apiKey, 'test-key')
    assert.equal(cfg.provider, 'ark')
    assert.equal(cfg.model, 'ark-code-latest')
    assert.equal(cfg.currentVault, '/some/kb')
    assert.equal(cfg.vaults?.[0].name, 'work')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeModelsJson: 写入 agentDir/models.json,内容可被 ModelRegistry 格式接受', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const written = writeModelsJson(agentDir, arkConfig())
    assert.equal(written, path.join(agentDir, 'models.json'))
    const onDisk = JSON.parse(await fs.readFile(written, 'utf-8'))
    assert.deepEqual(onDisk, generateModelsJson({ provider: 'ark', model: 'ark-code-latest' }))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
