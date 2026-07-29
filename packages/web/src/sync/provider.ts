import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import type { Module } from "@lagekatse/shared";
import { wsBase } from "../api";

export interface ModuleConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  destroy: () => void;
}

/**
 * Connect to one module document of a room. y-websocket dials
 * `${url}/${roomName}`, so we put the room id in the path and the module as
 * the "room name" — landing on the server route /sync/:roomId/:module — and
 * pass the session token as a query param.
 */
export function connectModule(roomId: string, module: Module, token: string): ModuleConnection {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${wsBase()}/sync/${roomId}`, module, doc, {
    params: { token },
    // The server is the sole authority. y-websocket would otherwise cross-sync
    // same-origin clients via BroadcastChannel, bypassing server-side rights
    // enforcement (a read-only client could then reach same-browser peers).
    disableBc: true,
  });
  return {
    doc,
    provider,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}
