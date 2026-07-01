import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { KB_SYSTEM_PROMPT } from "./prompt.js";
import { kbHooksFactory } from "./kbHooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const AGENT_DIR = path.join(PROJECT_ROOT, ".pi/agent");
const MODELS_JSON = path.join(AGENT_DIR, "models.json");

// 显式加载项目根目录的 .env(npm -w server 的 cwd 是 server/,默认 dotenv 找不到)
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

// LLM 配置(可配置项暴露于此,改 provider/model 在此调整)
const PROVIDER = "ark";
const MODEL_ID = "ark-code-latest";
const THINKING_LEVEL = "off" as const;

export interface AgentContext {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  resourceLoader: DefaultResourceLoader;
}

/**
 * 构建 agent 共享上下文:auth + model registry + resource loader(系统提示词 + kb 钩子)。
 * 对话 agent 与后台 ingest agent 共用同一份。
 */
export async function buildAgentContext(): Promise<AgentContext> {
  const authStorage = AuthStorage.create(path.join(AGENT_DIR, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, MODELS_JSON);

  // 运行时注入 API key(不落盘)。优先用 .env 的 ARK_API_KEY。
  const apiKey = process.env.ARK_API_KEY;
  if (apiKey) {
    authStorage.setRuntimeApiKey(PROVIDER, apiKey);
  }

  // 资源加载器:注入知识库系统提示词 + kb 钩子 extension
  const resourceLoader = new DefaultResourceLoader({
    cwd: PROJECT_ROOT,
    agentDir: AGENT_DIR,
    systemPromptOverride: () => KB_SYSTEM_PROMPT,
    extensionFactories: [kbHooksFactory],
  });
  await resourceLoader.reload();

  return { authStorage, modelRegistry, resourceLoader };
}

/** 查找配置好的模型,找不到则抛错。 */
export function resolveModel(ctx: AgentContext) {
  const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
  if (!model) {
    throw new Error(
      `模型未找到:provider="${PROVIDER}" id="${MODEL_ID}"。请检查 .pi/agent/models.json。`
    );
  }
  return model;
}

export interface CreateChatSessionOptions {
  ctx: AgentContext;
  onEvent: (event: AgentSessionEvent) => void;
}

/**
 * 创建对话 agent 会话(常驻,in-memory)。
 * 前端消息经 WS 进来 → session.prompt() → onEvent 推回前端。
 */
export async function createChatSession(
  opts: CreateChatSessionOptions
): Promise<AgentSession> {
  const model = resolveModel(opts.ctx);
  const { session } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir: AGENT_DIR,
    model,
    thinkingLevel: THINKING_LEVEL,
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    sessionManager: SessionManager.inMemory(),
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  });
  session.subscribe(opts.onEvent);
  return session;
}

export interface CreateIngestSessionOptions {
  ctx: AgentContext;
  onEvent: (event: AgentSessionEvent) => void;
}

/**
 * 创建后台 ingest agent 会话(每次上传新建,持久化到独立 jsonl 便于追溯)。
 * 共享对话 agent 的 loader/modelRegistry/auth,但会话独立。
 * 上传 .md → 归档 raw → session.prompt(Ingest 指令) → agent_end 推结果。
 */
export async function createIngestSession(
  opts: CreateIngestSessionOptions
): Promise<AgentSession> {
  const model = resolveModel(opts.ctx);
  const { session } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir: AGENT_DIR,
    model,
    thinkingLevel: THINKING_LEVEL,
    authStorage: opts.ctx.authStorage,
    modelRegistry: opts.ctx.modelRegistry,
    resourceLoader: opts.ctx.resourceLoader,
    // 持久化到 .pi/sessions/,文件名带时间戳避免覆盖
    sessionManager: SessionManager.create(path.join(AGENT_DIR, "sessions")),
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  });
  session.subscribe(opts.onEvent);
  return session;
}

// ── 文件写锁:避免对话 agent 与后台 ingest agent 同时写同一文件 ──
const writeLocks = new Map<string, Promise<unknown>>();

/** 对给定文件路径串行执行 async 任务(按文件排队)。 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeLocks.set(filePath, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // 清理:若当前锁已是队尾,移除避免 Map 无限增长
    if (writeLocks.get(filePath) === next) {
      writeLocks.delete(filePath);
    }
  }
}
