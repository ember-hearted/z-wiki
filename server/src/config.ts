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
  /** UI 暴露的 api 规范子集(默认 ['openai-completions','anthropic-messages'],见 apiSpecs.ts)。 */
  exposedApiSpecs?: string[]
  /** 已知 Vault 列表(切库用,首版可空)。 */
  vaults?: VaultEntry[]
  /** 当前打开的 Vault 路径(与 vaults 中某项 path 一致;首版可空,实际 kbRoot 由调用方传入)。 */
  currentVault?: string
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
const DEFAULT_CONTEXT_WINDOW = 128000

/**
 * 纯函数:输入 config 的 baseUrl/api/model,输出符合 pi 格式的 models.json 内容(ADR-0004 D1)。
 * provider key 固定 'custom'(D4)。model 空 → models 数组空(空壳能起,resolveModel 后续抛错)。
 * 启动时由 buildAgentContext 调用,结果写入 agentDir/models.json 喂 ModelRegistry。
 */
export function generateModelsJson(
  config: Pick<ConfigJson, 'baseUrl' | 'api' | 'model'>,
): ModelsJson {
  return {
    providers: {
      [PROVIDER_KEY]: {
        // 规范化兜底(ADR-0004 D3):无论 baseUrl 从 writeConfig(已规范化)还是手编 config.json
        // (未规范化)来,generateModelsJson 都保证喂给 pi 的是干净值,避免 SDK 双拼 suffix。
        baseUrl: normalizeBaseUrl(config.baseUrl, config.api),
        api: config.api,
        models: config.model ? [{ id: config.model, contextWindow: DEFAULT_CONTEXT_WINDOW }] : [],
      },
    },
  }
}

/**
 * 读取并校验 config.json(ADR-0004 D6 空壳能起)。
 * - 文件不存在 / 解析失败 → 抛错(失败快,提示从样板起步)。
 * - apiKey/baseUrl/model 空 → 不抛(空壳能起,调用 agent 时报错)。
 * - api 缺失/空 → 回退 'openai-completions' + warn。
 * - exposedApiSpecs 缺失/空 → 回退 DEFAULT_EXPOSED_SPECS。
 */
export function readConfig(configPath: string): ConfigJson {
  if (!existsSync(configPath)) {
    throw new Error(
      `配置文件不存在:${configPath}\n请从 config.example.json 复制为 config.json 并填入 LLM 配置。`,
    )
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
  // 显式列举 ConfigJson 已知字段,不 ...raw 全保留——避免老 config 的废弃字段(如 provider)
  // 残留进运行时对象 + 被 writeConfig 写回 config.json(ADR-0004 D1 干掉 provider 要彻底)。
  // 字段兜底:老 config 可能缺 baseUrl/apiKey/model(undefined),回退空字符串避免下游 .trim() 抛错。
  return {
    apiKey: raw.apiKey ?? '',
    baseUrl: raw.baseUrl ?? '',
    api,
    model: raw.model ?? '',
    exposedApiSpecs,
    vaults: raw.vaults,
    currentVault: raw.currentVault,
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
