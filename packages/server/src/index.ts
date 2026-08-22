import "./load-dotenv"; // must run before anything reads process.env
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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

  const app = Fastify({ logger: { transport: undefined }, trustProxy: config.trustProxy });
  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  // Rate-Limiting (Brute-Force-/Enumeration-Schutz, #64). Global als Grundschutz; sensible
  // Endpunkte (Join/Raum-Anlegen) setzen ein strengeres Limit per Route-Config. In-Memory-
  // Store (reicht für den Ein-Prozess-Betrieb, §13.2). Hinter Proxy braucht es trustProxy,
  // damit nicht alle Requests auf die Proxy-IP fallen.
  // Überschreitung wirft mit statusCode 429; die Antwort formt der zentrale
  // Error-Handler in http.ts einheitlich als { error: "rate_limited", message }.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });
  registerRoutes(app, { rooms, config, hub });

  // WebSocket gateway shares the same HTTP server.
  const wss = attachGateway(app.server, { hub, rooms, config });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `LageKatSe backend listening on :${config.port} — store: ${config.databaseUrl ? "postgres" : "memory"}`,
  );

  // --- Automatische Inaktivitäts-Retention (E10/#66) ---
  // Periodischer Sweep: Räume deren last_active_at älter als die Frist ist,
  // werden per Cascade-DELETE entfernt (nur Postgres relevant — Memory-Store
  // vergisst beim Neustart ohnehin, aber die Implementierung ist dieselbe).
  const retentionMs = config.retention.days * 24 * 60 * 60 * 1000;
  const runRetention = async () => {
    try {
      const stale = await store.getStaleRooms(retentionMs);
      if (stale.length === 0) {
        app.log.info(`[retention] swept 0 stale room(s) (limit: ${config.retention.days}d)`);
        return;
      }
      for (const room of stale) {
        await store.deleteRoom(room.id);
        app.log.info(`[retention] deleted stale room: ${room.name} (${room.joinCode}), last_active ${room.lastActiveAt}`);
      }
      app.log.info(`[retention] swept ${stale.length} stale room(s) (limit: ${config.retention.days}d)`);
    } catch (err) {
      app.log.error(err, "[retention] sweep failed");
    }
  };
  // Erster Sweep kurz nach Start (nicht sofort — gibt der DB Zeit hochzufahren),
  // danach im konfigurierten Intervall.
  const retentionTimer = setTimeout(() => void runRetention(), 10_000);
  const retentionInterval = setInterval(() => void runRetention(), config.retention.intervalMs);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`received ${signal}, shutting down…`);
    clearTimeout(retentionTimer);
    clearInterval(retentionInterval);
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
