import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyMultipart from "@fastify/multipart";
import type { WebSocket } from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import {
  buildAgentContext,
  createChatSession,
  createIngestSession,
  withFileLock,
  type AgentContext,
} from "./agent.js";
import { buildView } from "./buildView.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

// 默认 debug:让事件流(app.log.debug "pi event")与请求日志在开发期都可见;
// 生产可用 LOG_LEVEL=info 收敛。开发期用 pino-pretty 格式化输出。
const isDev = process.env.NODE_ENV !== "production";
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "debug",
    ...(isDev
      ? { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname", singleLine: true } } }
      : {}),
  },
});

await app.register(fastifyWebsocket);
await app.register(fastifyMultipart, {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// 健康检查端点
app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

// ── agent 共享上下文(启动时初始化)──────────────────────────────
let agentCtx: AgentContext | null = null;

// ── 对话 WS 客户端集合:ingest 完成后向它们广播 ──────────────────
const chatClients = new Set<WebSocket>();

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const c of chatClients) {
    if (c.readyState === 1 /* OPEN */) c.send(data);
  }
}

// ── text_delta 攒批:模型 token 级流式太碎,按时间窗口合并后再推 WS ──
const FLUSH_MS = 50;
type DeltaBuf = { text: string; timer: NodeJS.Timeout | null };
function getDeltaBuf(socket: WebSocket): DeltaBuf {
  // 挂在 socket 上,per-connection 隔离;类型用任意键绕过 WS 类型
  const s = socket as WebSocket & { __deltaBuf?: DeltaBuf };
  if (!s.__deltaBuf) s.__deltaBuf = { text: "", timer: null };
  return s.__deltaBuf;
}
function flushDelta(socket: WebSocket): void {
  const buf = getDeltaBuf(socket);
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (!buf.text) return;
  const text = buf.text;
  buf.text = "";
  socket.send(JSON.stringify({ type: "text_delta", text }));
  app.log.debug({ chars: text.length }, "text flushed");
}

/** 将 pi 的 AgentSessionEvent 转成前端可消费的简化消息,推给 WS。 */
function relayEvent(socket: WebSocket, event: unknown): void {
  const e = event as {
    type: string;
    assistantMessageEvent?: { type: string; delta?: string };
    toolName?: string;
    // read 的 args 形如 { file_path, offset?, limit? };其它工具各异,统一序列化
    args?: unknown;
    isError?: boolean;
  };
  // text_delta 逐条太碎,不打日志;攒批 flush 时另打一条汇总
  if (!(e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta")) {
    app.log.debug(
      {
        event: e.type,
        ae: e.assistantMessageEvent?.type,
        tool: e.toolName,
        args: e.args,
      },
      "pi event"
    );
  }

  switch (e.type) {
    case "message_update": {
      const ae = e.assistantMessageEvent;
      if (ae?.type === "text_delta" && ae.delta) {
        const buf = getDeltaBuf(socket);
        buf.text += ae.delta;
        // 已有定时器在跑就续用;否则开一个 50ms 窗口
        if (!buf.timer) {
          buf.timer = setTimeout(() => flushDelta(socket), FLUSH_MS);
        }
      } else {
        // text_end 等子事件:先冲掉缓冲的 delta,保证顺序
        flushDelta(socket);
      }
      break;
    }
    case "tool_execution_start":
      flushDelta(socket);
      socket.send(
        JSON.stringify({ type: "tool_start", tool: e.toolName, args: e.args })
      );
      break;
    case "tool_execution_end":
      flushDelta(socket);
      socket.send(
        JSON.stringify({ type: "tool_end", tool: e.toolName, error: Boolean(e.isError) })
      );
      break;
    case "agent_end":
      flushDelta(socket);
      socket.send(JSON.stringify({ type: "done" }));
      // 闭环刷新:agent 写完 wiki/output 后自动 build,有变更推 kb_updated
      void triggerBuild(socket);
      break;
    default:
      break;
  }
}

/** 构建 + 通知(给触发源 socket;ingest 完成时则广播给所有对话客户端)。 */
async function triggerBuild(notify: { send: (s: string) => void } | null): Promise<void> {
  const r = await buildView(PROJECT_ROOT);
  if (r.changed > 0) {
    const payload = JSON.stringify({
      type: "kb_updated",
      changed: r.changed,
      total: r.total,
    });
    if (notify) notify.send(payload);
    broadcast(payload);
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
  chatClients.add(socket);

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

  socket.on("close", () => {
    chatClients.delete(socket);
    // 清理未 flush 的 delta 缓冲与定时器,避免泄漏/迟到写入
    const buf = getDeltaBuf(socket);
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = null;
    buf.text = "";
  });
});

// ── 上传端点:接收 .md → 归档 raw/ → 触发后台 ingest agent ─────────
app.post("/api/upload", async (req, reply) => {
  if (!agentCtx) {
    return reply.code(503).send({ error: "agent 未就绪" });
  }
  const log = req.log;

  const file = await req.file();
  if (!file) {
    return reply.code(400).send({ error: "未提供文件" });
  }
  // 限制类型:仅 .md
  const ext = path.extname(file.filename).toLowerCase();
  if (ext !== ".md") {
    return reply.code(415).send({ error: "仅支持 .md 文件" });
  }

  // 安全的文件名:保留原命名,去掉路径与危险字符
  const safeName = path.basename(file.filename).replace(/[^\w.一-龥-]/g, "_");
  const rawDir = path.join(PROJECT_ROOT, "raw");
  const rawPath = path.join(rawDir, safeName);

  // 归档到 raw/(写锁)
  await withFileLock(rawPath, async () => {
    await fs.mkdir(rawDir, { recursive: true });
    const buf = await file.toBuffer();
    await fs.writeFile(rawPath, buf, "utf-8");
  });
  log.info({ rawPath: safeName }, "uploaded to raw/");

  // 立即回复客户端,ingest 在后台异步进行
  reply.send({ ok: true, raw: safeName, message: "已归档 raw/,后台编译中" });

  // 触发后台 ingest agent(不阻塞响应)
  void runIngest(safeName).catch((err) => {
    log.error({ err }, "ingest failed");
    broadcast({
      type: "ingest_error",
      raw: safeName,
      text: err instanceof Error ? err.message : String(err),
    });
  });
});

/** 后台 ingest:起独立 agent session,按 Ingest 工作流编译 raw 中的文件。 */
async function runIngest(rawName: string): Promise<void> {
  if (!agentCtx) return;
  const log = app.log.child({ raw: rawName });
  log.info("ingest started");

  const session = await createIngestSession({
    ctx: agentCtx,
    onEvent: (event) => {
      const e = event as { type: string };
      log.debug({ event: e.type }, "ingest event");
    },
  });

  const prompt = [
    `已上传文件 raw/${rawName}。请按 Ingest 工作流处理:`,
    `1. 读取 raw/${rawName} 内容`,
    `2. 按 §1 编译规则判断是否编译为 wiki(若该主题已积累 ≥3 篇或单篇 >100 行有独立概念价值)`,
    `3. 若值得编译:创建/更新 wiki 文章(含 frontmatter view 字段、来源引用 [[raw/${rawName}]]、反向链接),更新 index.md`,
    `4. 若内容达到产出 output 的条件(如可形成对比分析/报告),可产出 output`,
    `5. 追加 log.md`,
    `6. 若判断不值得编译,简短说明并结束`,
  ].join("\n");

  await session.prompt(prompt);
  log.info("ingest finished");

  // 通知对话客户端:ingest 完成 + 触发 build
  broadcast({ type: "ingest_done", raw: rawName });
  await triggerBuild(null);
}

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
    const r = await buildView(PROJECT_ROOT);
    app.log.info({ total: r.total, changed: r.changed }, "initial buildView done");
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`z-wiki server on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
