// index.ts — 薄入口:构建 AgentHost + Interaction,listen。
// Interaction 主体在 interaction.ts,可脱离 server 启动单测 import。
import { buildAgentContext } from "./agentHost.js";
import { createInteraction } from "./interaction.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const start = async (): Promise<void> => {
  try {
    const agentCtx = await buildAgentContext();
    const interaction = await createInteraction(agentCtx);
    interaction.log.info("agent context ready");

    // graceful shutdown:tsx watch / concurrently 在 Ctrl+C 时给子进程发信号,
    // 若有活跃 WebSocket 句柄 fastify 不会自行退出,会被反复 force kill。
    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (closing) return;
      closing = true;
      interaction.log.info({ signal }, "shutting down");
      await interaction.app.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    const total = await interaction.refreshView();
    interaction.log.info({ total }, "initial buildView done");
    await interaction.app.listen({ port: PORT, host: HOST });
    interaction.log.info(`z-wiki server on http://${HOST}:${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

void start();
