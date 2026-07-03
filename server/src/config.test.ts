import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  generateModelsJson,
  readConfig,
  writeModelsJson,
  writeConfig,
  PROVIDER_KEY,
  type ConfigJson,
} from './config.js'
import { DEFAULT_EXPOSED_SPECS } from './apiSpecs.js'

const llmConfig = (overrides: Partial<ConfigJson> = {}): ConfigJson => ({
  apiKey: 'test-key',
  baseUrl: 'https://api.example.com/v1',
  api: 'openai-completions',
  model: 'gpt-4o',
  ...overrides,
})

test('PROVIDER_KEY: 固定为 custom(三处引用对齐)', () => {
  assert.equal(PROVIDER_KEY, 'custom')
})

test('generateModelsJson: 产出符合 pi 格式的 models.json(provider key 固定 custom)', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  assert.deepEqual(json, {
    providers: {
      custom: {
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        models: [{ id: 'gpt-4o', contextWindow: 128000 }],
      },
    },
  })
})

test('generateModelsJson: anthropic-messages 规范透传 baseUrl/api', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    model: 'claude-sonnet-4-5',
  })
  assert.equal(json.providers.custom.api, 'anthropic-messages')
  assert.equal(json.providers.custom.baseUrl, 'https://api.anthropic.com')
  assert.equal(json.providers.custom.models[0].id, 'claude-sonnet-4-5')
})

test('generateModelsJson: model 空 → models 数组空(空壳能起)', () => {
  const json = generateModelsJson({ baseUrl: '', api: 'openai-completions', model: '' })
  assert.deepEqual(json.providers.custom.models, [])
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

test('readConfig: 缺 apiKey → 不报错(空壳能起,ADR-0004 D6)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ apiKey: '', baseUrl: '', api: 'openai-completions', model: '' }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.apiKey, '')
    assert.equal(cfg.model, '')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 缺 model → 不报错(空壳能起)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        apiKey: 'k',
        baseUrl: 'https://h/v1',
        api: 'openai-completions',
        model: '',
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.model, '')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 缺 api → 回退 openai-completions', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ apiKey: 'k', baseUrl: 'https://h/v1', model: 'gpt-4o' }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.api, 'openai-completions')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 缺 exposedApiSpecs → 回退默认值', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        apiKey: 'k',
        baseUrl: 'https://h/v1',
        api: 'openai-completions',
        model: 'gpt-4o',
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.deepEqual(cfg.exposedApiSpecs, DEFAULT_EXPOSED_SPECS)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: 正常 config → 返回 parsed 对象(含 vaults)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    const full = llmConfig({
      vaults: [{ path: '/some/kb', name: 'work' }],
      currentVault: '/some/kb',
    })
    await fs.writeFile(cfgPath, JSON.stringify(full), 'utf-8')
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.apiKey, 'test-key')
    assert.equal(cfg.baseUrl, 'https://api.example.com/v1')
    assert.equal(cfg.api, 'openai-completions')
    assert.equal(cfg.model, 'gpt-4o')
    assert.equal(cfg.currentVault, '/some/kb')
    assert.equal(cfg.vaults?.[0].name, 'work')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeModelsJson: 写入 agentDir/models.json,内容与 generateModelsJson 一致', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg = llmConfig()
    const written = writeModelsJson(agentDir, cfg)
    assert.equal(written, path.join(agentDir, 'models.json'))
    const onDisk = JSON.parse(await fs.readFile(written, 'utf-8'))
    assert.deepEqual(onDisk, generateModelsJson(cfg))
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeConfig: 写入时规范化 baseUrl(剥尾部 suffix)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    const cfg = llmConfig({
      baseUrl: 'https://api.example.com/v1/chat/completions',
      api: 'openai-completions',
    })
    writeConfig(cfgPath, cfg)
    const onDisk = JSON.parse(await fs.readFile(cfgPath, 'utf-8')) as ConfigJson
    assert.equal(onDisk.baseUrl, 'https://api.example.com/v1')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeConfig: 不 mutate 入参 config 对象', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    const cfg = llmConfig({
      baseUrl: 'https://api.example.com/v1/chat/completions',
      api: 'openai-completions',
    })
    const originalBaseUrl = cfg.baseUrl
    writeConfig(cfgPath, cfg)
    assert.equal(cfg.baseUrl, originalBaseUrl, '入参对象的 baseUrl 不应被 writeConfig 改动')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('generateModelsJson: 规范化带 suffix 的 baseUrl(兜底,避免 SDK 双拼)', () => {
  // 手编 config.json 带 suffix,启动路径不经 writeConfig → generateModelsJson 必须兜底规范化
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1/chat/completions',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  assert.equal(json.providers.custom.baseUrl, 'https://api.example.com/v1')
})

test('readConfig: 不保留老 config 的废弃 provider 字段(ADR-0004 D1)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    // 老 config 带 provider:'ark'(新 schema 已废弃)
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ apiKey: 'k', provider: 'ark', model: 'm' }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(
      (cfg as Record<string, unknown>).provider,
      undefined,
      'readConfig 不应保留废弃的 provider 字段',
    )
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: exposedApiSpecs 空数组 [] → 尊重用户意图(不回退默认)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        apiKey: 'k',
        baseUrl: '',
        api: 'openai-completions',
        model: '',
        exposedApiSpecs: [],
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.deepEqual(cfg.exposedApiSpecs, [])
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('空壳 config → ModelRegistry.create 不抛(D6 空壳能起的 pi 集成契约)', async () => {
  // 守护 ADR-0004 D6:空壳(baseUrl/model 空)时 pi loadCustomModels 对空 baseUrl 抛错,
  // 但被 try/catch 吞到 loadError(不向外抛),故 ModelRegistry.create 成功、server 能起。
  // 若 pi 升级改此行为(loadCustomModels 不再 catch),此测试会失败,暴露 D6 失效。
  const { ModelRegistry, AuthStorage } = await import('@earendil-works/pi-coding-agent')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg: ConfigJson = { apiKey: '', baseUrl: '', api: 'openai-completions', model: '' }
    const modelsJsonPath = writeModelsJson(agentDir, cfg)
    const authStorage = AuthStorage.inMemory()
    const registry = ModelRegistry.create(authStorage, modelsJsonPath)
    assert.ok(registry, '空壳 config 下 ModelRegistry.create 应成功')
    assert.equal(registry.find(PROVIDER_KEY, ''), undefined, '空壳下 find 应返回 undefined')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
