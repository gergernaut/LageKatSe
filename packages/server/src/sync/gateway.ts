import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { canWrite, isModule } from "@lagekatse/shared";
import { verifySession } from "../auth";
import type { Config } from "../config";
import type { RoomService } from "../rooms";
import { type Conn, RoomHub } from "./room-hub";

const PING_INTERVAL_MS = 30_000;

function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Attaches the WebSocket sync gateway to the given HTTP server.
 * URL scheme: ws://host/sync/:roomId/:module?token=<jwt>
 */
export function attachGateway(
  server: Server,
  deps: { hub: RoomHub; rooms: RoomService; config: Config },
): WebSocketServer {
  const { hub, rooms, config } = deps;
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/sync/")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(ws, url);
    });
  });

  async function handleConnection(ws: WebSocket, url: URL): Promise<void> {
    const parts = url.pathname.split("/").filter(Boolean); // ["sync", roomId, module]
    const roomId = parts[1] ?? "";
    const moduleParam = parts[2] ?? "";
    const token = url.searchParams.get("token") ?? "";

    const claims = await verifySession(token, config.jwtSecret);
    if (!claims || !roomId || !isModule(moduleParam)) {
      ws.close(4401, "unauthorized");
      return;
    }
    if (claims.room !== roomId) {
      ws.close(4403, "room_mismatch");
      return;
    }
    const room = await rooms.getById(roomId);
    if (!room) {
      ws.close(4404, "room_not_found");
      return;
    }

    const writable = canWrite(claims.roles, moduleParam, {
      allowMonitorChat: room.settings.allowMonitorChat,
    });

    const md = await hub.getDoc(roomId, moduleParam);
    const conn: Conn = {
      ws,
      sid: claims.sid,
      roomId,
      module: moduleParam,
      canWrite: writable,
      controlledIds: new Set(),
    };

    markAlive(ws);
    hub.addConn(md, conn);

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      hub.handleMessage(md, conn, toBytes(data));
    });
    ws.on("pong", () => markAlive(ws));
    ws.on("close", () => hub.removeConn(md, conn));
    ws.on("error", () => hub.removeConn(md, conn));
  }

  // Keepalive: terminate connections that stop answering pings.
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!isAlive(ws)) {
        ws.terminate();
        continue;
      }
      setAlive(ws, false);
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, PING_INTERVAL_MS);
  wss.on("close", () => clearInterval(pinger));

  return wss;
}

// --- tiny alive-flag helpers (kept off the public Conn type) ---
const aliveFlag = new WeakMap<WebSocket, boolean>();
const markAlive = (ws: WebSocket) => aliveFlag.set(ws, true);
const setAlive = (ws: WebSocket, v: boolean) => aliveFlag.set(ws, v);
const isAlive = (ws: WebSocket) => aliveFlag.get(ws) !== false;
