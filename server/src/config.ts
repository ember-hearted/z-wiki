// config.ts — 引导配置(config.json)的 schema + 纯函数生成器 + 读取。
// config.json 是桌面形态的唯一真相源(ADR-0003 D3.1):含 apiKey/provider/model、
// 已知 Vault 列表 + 当前 Vault、全局偏好。pi 的 models.json 为其派生产物(启动生成),
// auth.json 不落盘(apiKey 经 setRuntimeApiKey 运行时注入)。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// ── schema ────────────────────────────────────────────────────
export interface VaultEntry {
  /** Vault 的 kb/ 绝对路径。 */
  path: string
  /** 显示名(可空,默认取目录名)。 */
  name?: string
}

export interface ConfigJson {
  /** Ark API key(明文存 config.json,威胁模型见 ADR-0003 D3.1:本地单用户 + loopback)。 */
  apiKey: string
  /** LLM provider(首版固定 'ark';schema 支持未来扩展)。 */
  provider: string
  /** 模型 id(首版固定 'ark-code-latest')。 */
  model: string
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

// ── provider 元数据(首版只支持 ark)────────────────────────────
// ark provider 的固有属性(baseUrl/api),与 config 无关。未来多 provider 时扩此表。
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding'
const ARK_API = 'anthropic-messages'
const DEFAULT_CONTEXT_WINDOW = 128000

/**
 * 纯函数:输入 config 的 provider/model 字段,输出符合 pi 格式的 models.json 内容。
 * 首版只支持 ark provider;model id 从 config 读(动态),contextWindow 用默认值。
 * 启动时由 buildAgentContext 调用,结果写入 agentDir/models.json 喂 ModelRegistry。
 */
export function generateModelsJson(config: Pick<ConfigJson, 'provider' | 'model'>): ModelsJson {
  if (config.provider !== 'ark') {
    throw new Error(`不支持的 provider:"${config.provider}"(首版仅支持 ark)`)
  }
  return {
    providers: {
      ark: {
        baseUrl: ARK_BASE_URL,
        api: ARK_API,
        models: [{ id: config.model, contextWindow: DEFAULT_CONTEXT_WINDOW }],
      },
    },
  }
}

/**
 * 读取并校验 config.json。缺失或字段不全时失败快(对应 PRD:未配置 key 时明确提示)。
 * 不做 schema 全量验证,只校验启动所需字段(apiKey/provider/model)。
 */
export function readConfig(configPath: string): ConfigJson {
  if (!existsSync(configPath)) {
    throw new Error(
      `配置文件不存在:${configPath}\n请从 config.example.json 复制为 config.json 并填入 apiKey。`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (e) {
    throw new Error(`配置文件解析失败:${configPath}\n${(e as Error).message}`)
  }
  const cfg = parsed as ConfigJson
  if (!cfg.apiKey) {
    throw new Error('config.json 缺少 apiKey,agent 不可用。请填入 Ark API key。')
  }
  if (!cfg.provider) {
    throw new Error('config.json 缺少 provider(首版固定 "ark")。')
  }
  if (!cfg.model) {
    throw new Error('config.json 缺少 model(首版固定 "ark-code-latest")。')
  }
  return cfg
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
