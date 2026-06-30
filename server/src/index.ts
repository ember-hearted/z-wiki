import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);

// 健康检查端点
app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

// WebSocket 占位:对话事件桥将在任务 2 实现
app.get("/ws", { websocket: true }, (socket) => {
  app.log.info("ws client connected");
  socket.send(JSON.stringify({ type: "system", text: "connected" }));
  socket.on("message", (raw: Buffer) => {
    app.log.debug({ raw: raw.toString() }, "ws message (not handled yet)");
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
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`z-wiki server on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
