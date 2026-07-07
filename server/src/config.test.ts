import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  generateModelsJson,
  readConfig,
  writeModelsJson,
  writeShellSettingsJson,
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

test('generateModelsJson: contextWindow 自定义值 → 透传到 models.json', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',
    model: 'gpt-4o',
    contextWindow: 200000,
  })
  assert.equal(json.providers.custom.models[0].contextWindow, 200000)
})

test('generateModelsJson: contextWindow 缺省 → 回退默认 128000', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  assert.equal(json.providers.custom.models[0].contextWindow, 128000)
})

test('readConfig: 文件不存在 → 回退空壳默认值(空壳能起,不抛错;与 config.example.json 等价)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const missing = path.join(tmp, 'config.json')
    const cfg = readConfig(missing)
    // 空壳默认值:apiKey/baseUrl/model 空,api/exposedApiSpecs 回退默认,vaults/currentVault 空
    assert.equal(cfg.apiKey, '')
    assert.equal(cfg.baseUrl, '')
    assert.equal(cfg.model, '')
    assert.equal(cfg.api, 'openai-completions')
    assert.deepEqual(cfg.exposedApiSpecs, DEFAULT_EXPOSED_SPECS)
    assert.deepEqual(cfg.vaults, [])
    assert.equal(cfg.currentVault, '')
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

test('readConfig: contextWindow 合法正整数 → 透传', async () => {
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
        contextWindow: 200000,
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.contextWindow, 200000)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: contextWindow 非法值(0)→ 回退 undefined(走 generateModelsJson 兜底)', async () => {
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
        contextWindow: 0,
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.contextWindow, undefined, '非法 contextWindow(0)应回退 undefined')
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

test('readConfig: 老 schema(含 provider 字段)→ 抛清晰迁移错误(失败快,不静默兜底成空壳)', async () => {
  // 切片 1 之前 config.json 用 provider 字段(ark)。新 schema 干掉 provider,改 baseUrl/api/model。
  // 静默丢弃 provider 会兜底成空 baseUrl → resolveModel 抛误导性「模型未找到」。
  // 失败快:检测到 provider 字段时明确要求迁移(回归:曾因静默兜底导致启动报「模型未找到」)。
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ apiKey: 'k', provider: 'ark', model: 'ark-code-latest' }),
      'utf-8',
    )
    assert.throws(
      () => readConfig(cfgPath),
      /检测到老 schema[\s\S]*provider[\s\S]*baseUrl[\s\S]*api[\s\S]*model/,
      '老 schema 应抛迁移错误,而非静默丢弃 provider',
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

test('齐配置 config(火山 ark)→ ModelRegistry.find 成功(回归:老 schema 缺 baseUrl/api 致 find undefined)', async () => {
  // 回归 bug:切片 1 schema 改造没迁移老 config.json(provider:'ark' 缺 baseUrl/api),
  // readConfig 兜底成空 baseUrl → pi 不注册 custom provider → find undefined →「模型未找到」。
  // 齐配置(真实 baseUrl + api + model)应能找到。
  const { ModelRegistry, AuthStorage } = await import('@earendil-works/pi-coding-agent')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg: ConfigJson = {
      apiKey: 'k',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      api: 'anthropic-messages',
      model: 'ark-code-latest',
    }
    const modelsJsonPath = writeModelsJson(agentDir, cfg)
    const authStorage = AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(PROVIDER_KEY, cfg.apiKey)
    const registry = ModelRegistry.create(authStorage, modelsJsonPath)
    const model = registry.find(PROVIDER_KEY, cfg.model)
    assert.ok(model, '齐配置下 find 应返回 model(非 undefined)')
    if (model) {
      assert.equal(model.id, 'ark-code-latest')
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

// ── shellPath(ADR-0003 D6 预留的 shellPath 覆盖口子)──

test('readConfig: 缺 shellPath → 回退空串(走 pi 自动探测)', async () => {
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
    assert.equal(cfg.shellPath, '')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: shellPath 字符串 → 透传(完整路径原样保留)', async () => {
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
        shellPath: 'C:\\Git\\bin\\bash.exe',
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.shellPath, 'C:\\Git\\bin\\bash.exe')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('readConfig: shellPath 非字符串(数字)→ 回退空串(边界校验)', async () => {
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
        shellPath: 123,
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal(cfg.shellPath, '', '非字符串 shellPath 应回退空串')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeShellSettingsJson: shellPath 非空 → 注入 settings.json', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg = llmConfig({ shellPath: 'C:\\Git\\bin\\bash.exe' })
    const written = writeShellSettingsJson(agentDir, cfg)
    assert.equal(written, path.join(agentDir, 'settings.json'))
    const onDisk = JSON.parse(await fs.readFile(written, 'utf-8'))
    assert.equal(onDisk.shellPath, 'C:\\Git\\bin\\bash.exe')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeShellSettingsJson: shellPath 空 → 删字段让 pi 走自动探测(不写空串)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({ shellPath: 'C:\\old\\bash.exe' }),
      'utf-8',
    )
    const cfg = llmConfig({ shellPath: '' })
    writeShellSettingsJson(agentDir, cfg)
    const onDisk = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf-8'))
    assert.equal(onDisk.shellPath, undefined, '空 shellPath 应删除字段,而非留空串')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeShellSettingsJson: 保留 pi 写的其他字段(read-modify-write,不整对象覆盖)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({ lastChangelogVersion: '1.2.0', defaultModel: 'gpt-4o' }),
      'utf-8',
    )
    const cfg = llmConfig({ shellPath: 'C:\\Git\\bin\\bash.exe' })
    writeShellSettingsJson(agentDir, cfg)
    const onDisk = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf-8'))
    assert.equal(onDisk.shellPath, 'C:\\Git\\bin\\bash.exe')
    assert.equal(onDisk.lastChangelogVersion, '1.2.0', 'pi 写的字段应保留')
    assert.equal(onDisk.defaultModel, 'gpt-4o', 'pi 写的字段应保留')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeShellSettingsJson: 文件损坏 → 视为空再注入(不抛错)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(path.join(agentDir, 'settings.json'), '{not valid json', 'utf-8')
    const cfg = llmConfig({ shellPath: 'C:\\Git\\bin\\bash.exe' })
    writeShellSettingsJson(agentDir, cfg)
    const onDisk = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf-8'))
    assert.equal(onDisk.shellPath, 'C:\\Git\\bin\\bash.exe')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('writeShellSettingsJson: 不 mutate 入参 config 对象', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg = llmConfig({ shellPath: 'C:\\Git\\bin\\bash.exe' })
    const original = cfg.shellPath
    writeShellSettingsJson(agentDir, cfg)
    assert.equal(cfg.shellPath, original, '入参 config 不应被改动')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})
