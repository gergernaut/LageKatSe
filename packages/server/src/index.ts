import "./load-dotenv"; // must run before anything reads process.env
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadConfig } from "./config";
import { registerRoutes } from "./http";
import { RoomService } from "./rooms";
import { createStore } from "./store";
import { attachGateway } from "./sync/gateway";
import { RoomHub } from "./sync/room-hub";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = await createStore(config);
  const rooms = new RoomService(store);
  const hub = new RoomHub(store);

  const app = Fastify({ logger: { transport: undefined } });
  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  registerRoutes(app, { rooms, config, hub });

  // WebSocket gateway shares the same HTTP server.
  const wss = attachGateway(app.server, { hub, rooms, config });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `LageKatSe backend listening on :${config.port} — store: ${config.databaseUrl ? "postgres" : "memory"}`,
  );

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`received ${signal}, shutting down…`);
    try {
      wss.close();
      for (const ws of wss.clients) ws.terminate();
      await hub.closeAll();
      await app.close();
      await store.close();
    } catch (err) {
      app.log.error(err, "shutdown failed");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
