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
    // Attach the message listener *before* the async setup below. The client
    // sends its opening sync frames the instant the socket is open; if we only
    // listened after awaiting auth + doc-load, those frames would be dropped and
    // a hot-join into a non-empty room could miss existing state. Buffer until
    // ready, then flush in order.
    let md: Awaited<ReturnType<RoomHub["getDoc"]>> | null = null;
    let conn: Conn | null = null;
    const pending: Uint8Array[] = [];
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = toBytes(data);
      if (md && conn) hub.handleMessage(md, conn, bytes);
      else pending.push(bytes);
    });

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
    const loaded = await hub.getDoc(roomId, moduleParam);

    // The socket may have closed while we were setting up.
    if (ws.readyState !== WebSocket.OPEN) return;

    conn = {
      ws,
      sid: claims.sid,
      roomId,
      module: moduleParam,
      canWrite: writable,
      controlledIds: new Set(),
    };
    md = loaded;

    markAlive(ws);
    ws.on("pong", () => markAlive(ws));
    ws.on("close", () => hub.removeConn(loaded, conn!));
    ws.on("error", () => hub.removeConn(loaded, conn!));

    hub.addConn(md, conn);
    // Flush frames buffered during setup, in arrival order (runs synchronously
    // right after md/conn are set, so no live frame can jump ahead of these).
    for (const bytes of pending) hub.handleMessage(md, conn, bytes);
    pending.length = 0;
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
