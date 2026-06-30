import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "@fastify/websocket";
import { buildAgentContext, createChatSession, type AgentContext } from "./agent.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);

// 健康检查端点
app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

// ── agent 共享上下文 + 对话 session(启动时初始化)──────────────────────
let agentCtx: AgentContext | null = null;

/** 将 pi 的 AgentSessionEvent 转成前端可消费的简化消息,推给 WS。 */
function relayEvent(socket: WebSocket, event: unknown): void {
  const e = event as {
    type: string;
    assistantMessageEvent?: { type: string; delta?: string };
    toolName?: string;
    isError?: boolean;
    message?: unknown;
    messages?: unknown;
  };
  // 开发期:全量事件落日志,便于排查 LLM 流(debug 级,默认不输出)
  app.log.debug({ event: e.type, ae: e.assistantMessageEvent?.type }, "pi event");

  switch (e.type) {
    case "message_update":
      if (e.assistantMessageEvent?.type === "text_delta" && e.assistantMessageEvent.delta) {
        socket.send(
          JSON.stringify({ type: "text_delta", text: e.assistantMessageEvent.delta })
        );
      }
      break;
    case "tool_execution_start":
      socket.send(JSON.stringify({ type: "tool_start", tool: e.toolName }));
      break;
    case "tool_execution_end":
      socket.send(
        JSON.stringify({ type: "tool_end", tool: e.toolName, error: Boolean(e.isError) })
      );
      break;
    case "agent_end":
      socket.send(JSON.stringify({ type: "done" }));
      break;
    default:
      break;
  }
}

// WebSocket:对话事件桥
app.get("/ws", { websocket: true }, async (socket, req) => {
  const log = req.log;
  if (!agentCtx) {
    socket.send(JSON.stringify({ type: "error", text: "agent 未就绪" }));
    return;
  }
  log.info("ws client connected");

  const session = await createChatSession({
    ctx: agentCtx,
    onEvent: (event) => relayEvent(socket, event),
  });

  socket.on("message", async (raw: Buffer) => {
    const msg = JSON.parse(raw.toString()) as { text?: string };
    if (!msg.text) return;
    try {
      await session.prompt(msg.text);
    } catch (err) {
      log.error({ err }, "prompt failed");
      socket.send(
        JSON.stringify({ type: "error", text: err instanceof Error ? err.message : String(err) })
      );
    }
  });
});

// 生产环境托管前端构建产物(@fastify/static)将在打包阶段加入;
// dev 时前端走自己的 vite 端口,通过 vite proxy 转发 /api 与 /ws 到本服务。
app.get("/", async (_req, reply) =>
  reply.type("text/plain").send(
    "z-wiki server. 开发模式请访问 vite dev server;前端构建产物托管待打包阶段接入。"
  )
);

const start = async () => {
  try {
    agentCtx = await buildAgentContext();
    app.log.info("agent context ready");
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`z-wiki server on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
