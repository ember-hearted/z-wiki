// config.ts — 引导配置(config.json)的 schema + 纯函数生成器 + 读取。
// config.json 是桌面形态的唯一真相源(ADR-0003 D3.1 / ADR-0004):含 apiKey/baseUrl/api/model、
// 暴露的 api 规范列表、已知 Vault 列表 + 当前 Vault、全局偏好。pi 的 models.json 为其派生产物
// (启动生成),auth.json 不落盘(apiKey 经 setRuntimeApiKey 运行时注入)。
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_EXPOSED_SPECS, normalizeBaseUrl } from './apiSpecs.js'

// ── schema ────────────────────────────────────────────────────
export interface VaultEntry {
  /** Vault 的 kb/ 绝对路径。 */
  path: string
  /** 显示名(可空,默认取目录名)。 */
  name?: string
}

export interface ConfigJson {
  /** LLM API key(明文存 config.json,威胁模型见 ADR-0003 D3.1:本地单用户 + loopback)。 */
  apiKey: string
  /** LLM 端点 baseUrl(写入时规范化,见 ADR-0004 D3)。空 = 未配置(空壳能起,调用 agent 报错)。 */
  baseUrl: string
  /** LLM api 规范(openai-completions / anthropic-messages,见 apiSpecs.ts)。 */
  api: string
  /** 模型 id(如 ark-code-latest / gpt-4o)。空 = 未配置。 */
  model: string
  /** 上下文窗口大小(tokens,写入 models.json 的 contextWindow)。可选,缺省/非法回退 DEFAULT_CONTEXT_WINDOW(128000)。 */
  contextWindow?: number
  /** UI 暴露的 api 规范子集(默认 ['openai-completions','anthropic-messages'],见 apiSpecs.ts)。 */
  exposedApiSpecs?: string[]
  /** 已知 Vault 列表(切库用,首版可空)。 */
  vaults?: VaultEntry[]
  /** 当前打开的 Vault 路径(与 vaults 中某项 path 一致;首版可空,实际 kbRoot 由调用方传入)。 */
  currentVault?: string
  /**
   * Git Bash 可执行文件路径(可选,ADR-0003 D6 预留的 shellPath 覆盖口子)。
   * 非空 → 启动时派生写入 pi 的 agentDir/settings.json,覆盖 pi 自动探测(Program Files\Git\bin\bash.exe → PATH)。
   * 空 → 不写 shellPath 字段,pi 走自动探测。仅桌面 win 形态实际消费;dev/unix 形态填了也无害(pi getShellConfig 对不存在路径抛错,但默认工具集不含 bash)。
   */
  shellPath?: string
  /** 全局偏好(首版占位,未来扩展)。 */
  preferences?: Record<string, unknown>
}

/** pi models.json 的格式(`{providers:{...}}`),generateModelsJson 的输出类型。 */
export interface ModelsJson {
  providers: Record<
    string,
    {
      baseUrl: string
      api: string
      models: Array<{ id: string; contextWindow: number }>
    }
  >
}

// ── provider key(ADR-0004 D4)────────────────────────────────────
// 干掉 provider 概念后,models.json 的 provider key 固定为 'custom':
// models.json={providers:{custom:{...}}},setRuntimeApiKey('custom',key),find('custom',modelId)。
// 三处用同一常量,避免拼错导致 model 解析失败。
export const PROVIDER_KEY = 'custom'

const DEFAULT_API = 'openai-completions'
export const DEFAULT_CONTEXT_WINDOW = 128000

/**
 * 空壳配置默认值(与 config.example.json 对齐)。readConfig 在 config.json 不存在时返回此值,
 * 让 server 以空壳起来(ADR-0004 D6「空壳能起」),用户后续在设置页填配置时 writeConfig 创建真实 config.json。
 */
const EMPTY_CONFIG: ConfigJson = {
  apiKey: '',
  baseUrl: '',
  api: DEFAULT_API,
  model: '',
  exposedApiSpecs: [...DEFAULT_EXPOSED_SPECS],
  vaults: [],
  currentVault: '',
  shellPath: '',
  preferences: {},
}

/**
 * 掩码 apiKey 供设置页展示(不回显明文,ADR-0004 D1):
 * - 空 → 空字符串(未配置)
 * - 长度 ≤ 8 → 固定 8 个圆点(不泄露长度)
 * - 长度 > 8 → 前 4 位 + 8 圆点 + 后 4 位(可见首尾便于辨识,中间固定长度不泄露真实长度)
 */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

/**
 * 纯函数:输入 config 的 baseUrl/api/model/contextWindow,输出符合 pi 格式的 models.json 内容(ADR-0004 D1)。
 * provider key 固定 'custom'(D4)。model 空 → models 数组空(空壳能起,resolveModel 后续抛错)。
 * contextWindow 缺省/undefined → 回退 DEFAULT_CONTEXT_WINDOW(128000,readConfig 已校验非法值为 undefined)。
 * 启动时由 buildAgentContext 调用,结果写入 agentDir/models.json 喂 ModelRegistry。
 */
export function generateModelsJson(
  config: Pick<ConfigJson, 'baseUrl' | 'api' | 'model' | 'contextWindow'>,
): ModelsJson {
  return {
    providers: {
      [PROVIDER_KEY]: {
        // 规范化兜底(ADR-0004 D3):无论 baseUrl 从 writeConfig(已规范化)还是手编 config.json
        // (未规范化)来,generateModelsJson 都保证喂给 pi 的是干净值,避免 SDK 双拼 suffix。
        baseUrl: normalizeBaseUrl(config.baseUrl, config.api),
        api: config.api,
        models: config.model
          ? [{ id: config.model, contextWindow: config.contextWindow ?? DEFAULT_CONTEXT_WINDOW }]
          : [],
      },
    },
  }
}

/**
 * 读取并校验 config.json(ADR-0004 D6 空壳能起)。
 * - 文件不存在 → 回退空壳默认值(EMPTY_CONFIG,与 config.example.json 等价)+ warn,不抛错、不写盘。
 *   契合空壳能起:server 先起来,用户在设置页填配置时 writeConfig 创建真实 config.json。
 * - 解析失败 → 抛错(失败快,提示文件损坏)。
 * - apiKey/baseUrl/model 空 → 不抛(空壳能起,调用 agent 时报错)。
 * - api 缺失/空 → 回退 'openai-completions' + warn。
 * - exposedApiSpecs 缺失/空 → 回退 DEFAULT_EXPOSED_SPECS。
 * - 老 schema(含 provider 字段)→ 抛迁移错误(失败快,不静默兜底成空壳)。
 */
export function readConfig(configPath: string): ConfigJson {
  if (!existsSync(configPath)) {
    // 文件不存在:回退空壳默认值(与 config.example.json 等价),不抛错、不写盘。
    // 契合 ADR-0004 D6「空壳能起」——文件缺失也是一种空壳,agent 调用时再报 apiKey/baseUrl 空。
    // 不自动 cp example:dev 形态 config.json 是 gitignored 真相源,自动写盘制造多余文件;
    // 用户在 web 设置页(/settings → POST /api/config/llm → writeConfig)填配置时自然落盘。
    console.warn(
      `[z-wiki] 配置文件不存在:${configPath}。使用空壳默认值启动(agent 调用会失败,直到填入 LLM 配置)。\n` +
        `填入配置:复制 config.example.json 为 config.json,或在 web 设置页(/settings)填写。`,
    )
    return EMPTY_CONFIG
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    throw new Error(`配置文件解析失败:${configPath}\n${(e as Error).message}`)
  }
  const raw = parsed as ConfigJson
  // 老 schema 检测(切片 1 之前 config.json 用 provider 字段):静默丢弃会兜底成空 baseUrl →
  // resolveModel 抛误导性「模型未找到」。失败快:检测到 provider 字段时明确要求迁移。
  const legacyProvider = (raw as unknown as Record<string, unknown>).provider
  if (legacyProvider !== undefined) {
    throw new Error(
      `检测到老 schema(config.json 含 "provider" 字段:${JSON.stringify(legacyProvider)})。\n` +
        `切片 1(commit 43de07c)已干掉 provider 预设,改为 baseUrl/api/model 可配。\n` +
        `请迁移 config.json:删除 provider,补齐 baseUrl/api/model(参考 config.example.json)。\n` +
        `ark 迁移参考:baseUrl="https://ark.cn-beijing.volces.com/api/coding",api="anthropic-messages"。`,
    )
  }
  const api = raw.api || DEFAULT_API
  if (!raw.api) {
    console.warn('[z-wiki] config.json 的 api 为空,回退 openai-completions。')
  }
  // exposedApiSpecs:undefined/非数组 → 回退默认;空数组 [] → 尊重用户显式配置(不回退)。
  const exposedApiSpecs = Array.isArray(raw.exposedApiSpecs)
    ? raw.exposedApiSpecs
    : [...DEFAULT_EXPOSED_SPECS]
  // contextWindow:必须是正整数(number),否则 warn + 回退 undefined(走 generateModelsJson 兜底
  // 默认 128000)。undefined/缺失 → 保持 undefined。老 config 无此字段正常(新加字段,不抛错)。
  const contextWindow =
    typeof raw.contextWindow === 'number' &&
    Number.isInteger(raw.contextWindow) &&
    raw.contextWindow > 0
      ? raw.contextWindow
      : undefined
  if (raw.contextWindow !== undefined && contextWindow === undefined) {
    console.warn(
      `[z-wiki] config.json 的 contextWindow 非法(${JSON.stringify(raw.contextWindow)}),回退默认 ${DEFAULT_CONTEXT_WINDOW}。`,
    )
  }
  // 显式列举 ConfigJson 已知字段,不 ...raw 全保留——避免老 config 的废弃字段(如 provider)
  // 残留进运行时对象 + 被 writeConfig 写回 config.json(ADR-0004 D1 干掉 provider 要彻底)。
  // 字段兜底:老 config 可能缺 baseUrl/apiKey/model(undefined),回退空字符串避免下游 .trim() 抛错。
  return {
    apiKey: raw.apiKey ?? '',
    baseUrl: raw.baseUrl ?? '',
    api,
    model: raw.model ?? '',
    contextWindow,
    exposedApiSpecs,
    vaults: raw.vaults,
    currentVault: raw.currentVault,
    // shellPath:非字符串(含 undefined)→ 空(走 pi 自动探测)。不 trim,完整路径原样保留。
    shellPath: typeof raw.shellPath === 'string' ? raw.shellPath : '',
    preferences: raw.preferences,
  }
}

/**
 * 生成 models.json 内容并写入 agentDir/models.json(启动派生产物,可丢可重建)。
 * 返回写入的路径,供 ModelRegistry.create 加载。
 */
export function writeModelsJson(agentDir: string, config: ConfigJson): string {
  const modelsJsonPath = path.join(agentDir, 'models.json')
  const content = generateModelsJson(config)
  writeFileSync(modelsJsonPath, JSON.stringify(content, null, 2), 'utf-8')
  return modelsJsonPath
}

/**
 * 派生写入 pi 的 agentDir/settings.json 的 shellPath 字段(ADR-0003 D6 预留的 shellPath 覆盖口子)。
 * 与 models.json 同为启动派生产物,但 settings.json 由 pi 管理全局设置(lastChangelogVersion/defaultModel 等),
 * 故用 read-modify-write:只注入或删除 shellPath,保留 pi 写的其他字段(不整对象覆盖)。
 * - shellPath 非空 → 设字段,覆盖 pi 自动探测(Program Files\Git\bin\bash.exe → PATH)。
 * - shellPath 空 → 删字段,让 pi 走自动探测(不写空串,避免 pi 把 "" 当 customShellPath 抛 "not found")。
 * 仅在 buildAgentContext(启动)调用,运行时不写——避免与 pi 运行时写该文件的并发竞态;
 * 故改 shellPath 后需重启 app 才生效(POST /api/config/shell 只写 config.json 真相源)。
 */
export function writeShellSettingsJson(agentDir: string, config: ConfigJson): string {
  const settingsPath = path.join(agentDir, 'settings.json')
  let current: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, unknown>
      }
    } catch {
      // 损坏视为空(派生产物,不致命;pi 自身加载 settings.json 也 catch 不外抛)
    }
  }
  const next: Record<string, unknown> = { ...current }
  if (config.shellPath?.trim()) {
    next.shellPath = config.shellPath
  } else {
    delete next.shellPath
  }
  writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf-8')
  return settingsPath
}

/**
 * 原子写整份 config.json(tmp+rename,避免写半崩溃损坏真相源,参照 windowState.ts/firstRun.ts)。
 * 写入前规范化 baseUrl(ADR-0004 D3):剥尾部已知 suffix + trailing slash。
 * 调用方负责 read-modify-write 语义与并发串行化(交互层用 withFileLock 包裹)。
 */
export function writeConfig(configPath: string, config: ConfigJson): void {
  const normalized: ConfigJson = {
    ...config,
    baseUrl: normalizeBaseUrl(config.baseUrl, config.api),
  }
  const tmp = `${configPath}.tmp`
  writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf-8')
  renameSync(tmp, configPath)
}
