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
        models: [
          {
            id: 'gpt-4o',
            contextWindow: 128000,
            reasoning: true,
            compat: { supportsDeveloperRole: false },
          },
        ],
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

test('generateModelsJson: DeepSeek baseUrl → reasoning 恒 true + thinkingLevelMap(ADR-0021)', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.deepseek.com',
    api: 'openai-completions',
    model: 'deepseek-v4-pro',
  })
  // reasoning 恒 true(乐观声明)+ DeepSeek 注入 effort 映射(DeepSeek 只认 high/max)
  // + deepseek 思考格式(off 显式发 thinking.disabled,否则 relay 默认开思考)
  assert.deepEqual(json.providers.custom.models[0], {
    id: 'deepseek-v4-pro',
    contextWindow: 128000,
    reasoning: true,
    thinkingLevelMap: { minimal: 'high', low: 'high', medium: 'high', high: 'high', xhigh: 'max' },
    compat: { supportsDeveloperRole: false, thinkingFormat: 'deepseek' },
  })
})

test('generateModelsJson: ark 代理跑 DeepSeek(model.id 含 deepseek)也注入 thinkingLevelMap', () => {
  // baseUrl 不含 deepseek.com(ark 等代理),但 model.id 含 deepseek -> 识别为 DeepSeek 注入映射。
  const json = generateModelsJson({
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    api: 'anthropic-messages',
    model: 'deepseek-v4-pro',
  })
  assert.equal(json.providers.custom.models[0].reasoning, true)
  assert.deepEqual(json.providers.custom.models[0].thinkingLevelMap, {
    minimal: 'high',
    low: 'high',
    medium: 'high',
    high: 'high',
    xhigh: 'max',
  })
})

test('generateModelsJson: reasoning 恒 true(ADR-0021 乐观声明),非 DeepSeek 无 thinkingLevelMap', () => {
  // 非 DeepSeek:reasoning 恒 true,不注入映射(走 pi 默认:传 pi 档名,provider 自行映射或忽略)。
  // 不支持思考的 model 也恒 true--off 时 pi 不发思考参数,零副作用;on 时由 provider 报错/忽略。
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  assert.equal(json.providers.custom.models[0].reasoning, true)
  assert.equal(json.providers.custom.models[0].thinkingLevelMap, undefined)
})

test('generateModelsJson: openai-completions 恒注入 compat.supportsDeveloperRole=false', () => {
  // pi 对 custom provider 默认 supportsDeveloperRole=true,system prompt 以 role:developer 发送;
  // 部分中转(如 token.sensenova.cn)只认 system/assistant/user/tool → 400。恒注入 false 让 pi 发
  // system(全 provider 通用,真 OpenAI 也接受)。DeepSeek 另注入 deepseek 思考格式(off 显式关)。
  const json = generateModelsJson({
    baseUrl: 'https://token.sensenova.cn/v1',
    api: 'openai-completions',
    model: 'deepseek-v4-flash',
  })
  assert.deepEqual(json.providers.custom.models[0].compat, {
    supportsDeveloperRole: false,
    thinkingFormat: 'deepseek',
  })
})

test('generateModelsJson: 非 DeepSeek 的 openai-completions 不注入 thinkingFormat', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.example.com/v1',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  assert.deepEqual(json.providers.custom.models[0].compat, { supportsDeveloperRole: false })
})

test('generateModelsJson: anthropic-messages 不注入 compat(developer 角色是 openai-completions 概念)', () => {
  const json = generateModelsJson({
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    model: 'claude-sonnet-4-5',
  })
  assert.equal(json.providers.custom.models[0].compat, undefined)
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

test('readConfig: 老 config 残留 reasoning 字段 → 静默忽略,不报错不进运行时对象(ADR-0021)', async () => {
  // ADR-0021 移除 config.reasoning(改恒 true 乐观声明)。与 provider 不同:reasoning 被忽略
  // 无副作用(off 时 pi 不发思考参数),故逐字段解析天然丢弃即可,不需要迁移报错。
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const cfgPath = path.join(tmp, 'config.json')
    await fs.writeFile(
      cfgPath,
      JSON.stringify({
        apiKey: 'k',
        baseUrl: 'https://api.example.com/v1',
        model: 'm',
        reasoning: false,
      }),
      'utf-8',
    )
    const cfg = readConfig(cfgPath)
    assert.equal('reasoning' in cfg, false, 'reasoning 不应进运行时 ConfigJson')
    assert.equal(cfg.model, 'm')
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

test('空壳 config → ModelRegistry 构造不抛(D6 空壳能起的 pi 集成契约)', async () => {
  // 守护 ADR-0004 D6:空壳(baseUrl/model 空)时 pi loadCustomModels 对空 baseUrl 抛错,
  // 但被 try/catch 吞到 loadError(不向外抛),故 ModelRuntime.create + ModelRegistry 构造成功、server 能起。
  // 若 pi 升级改此行为(loadCustomModels 不再 catch),此测试会失败,暴露 D6 失效。
  const { ModelRegistry, ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zwiki-cfg-'))
  try {
    const agentDir = path.join(tmp, '.pi/agent')
    await fs.mkdir(agentDir, { recursive: true })
    const cfg: ConfigJson = { apiKey: '', baseUrl: '', api: 'openai-completions', model: '' }
    const modelsJsonPath = writeModelsJson(agentDir, cfg)
    const modelRuntime = await ModelRuntime.create({ modelsPath: modelsJsonPath })
    const registry = new ModelRegistry(modelRuntime)
    assert.ok(registry, '空壳 config 下 ModelRegistry 构造应成功')
    assert.equal(registry.find(PROVIDER_KEY, ''), undefined, '空壳下 find 应返回 undefined')
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
})

test('齐配置 config(火山 ark)→ ModelRegistry.find 成功(回归:老 schema 缺 baseUrl/api 致 find undefined)', async () => {
  // 回归 bug:切片 1 schema 改造没迁移老 config.json(provider:'ark' 缺 baseUrl/api),
  // readConfig 兜底成空 baseUrl → pi 不注册 custom provider → find undefined →「模型未找到」。
  // 齐配置(真实 baseUrl + api + model)应能找到。
  const { ModelRegistry, ModelRuntime } = await import('@earendil-works/pi-coding-agent')
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
    const modelRuntime = await ModelRuntime.create({ modelsPath: modelsJsonPath })
    await modelRuntime.setRuntimeApiKey(PROVIDER_KEY, cfg.apiKey)
    const registry = new ModelRegistry(modelRuntime)
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

test('generateModelsJson: baseUrl 子串含 deepseek.com 但 hostname 非官方域,不注入 thinkingLevelMap', () => {
  // CodeQL js/incomplete-url-substring-sanitization:'deepseek.com' 可出现在路径或其他域名里,按 hostname 匹配。
  const json = generateModelsJson({
    baseUrl: 'https://evil.com/deepseek.com',
    api: 'openai-completions',
    model: 'gpt-4o',
  })
  // reasoning 恒 true(ADR-0021);关键是不能误判 DeepSeek 注入 thinkingLevelMap
  assert.equal(json.providers.custom.models[0].reasoning, true)
  assert.equal(json.providers.custom.models[0].thinkingLevelMap, undefined)
})

test('generateModelsJson: 无协议 baseUrl 也按 hostname 识别(api.deepseek.com)', () => {
  const json = generateModelsJson({
    baseUrl: 'api.deepseek.com/v1',
    api: 'openai-completions',
    model: 'deepseek-v4-pro',
  })
  assert.equal(json.providers.custom.models[0].reasoning, true)
  assert.ok(json.providers.custom.models[0].thinkingLevelMap)
})
