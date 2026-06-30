import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const AGENT_DIR = path.join(PROJECT_ROOT, ".pi/agent");
const MODELS_JSON = path.join(AGENT_DIR, "models.json");

// LLM 配置(可配置项暴露于此,改 provider/model 在此调整)
const PROVIDER = "ark";
const MODEL_ID = "ark-code-latest";
const THINKING_LEVEL = "off" as const;

export interface AgentContext {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

/**
 * 构建 agent 共享上下文:auth + model registry(指向项目 .pi/agent/models.json)。
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

  return { authStorage, modelRegistry };
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
    sessionManager: SessionManager.inMemory(),
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  });
  session.subscribe(opts.onEvent);
  return session;
}
