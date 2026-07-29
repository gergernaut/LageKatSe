import { useEffect, useRef, useState } from "react";
import { CHAT_ARRAY, canWrite, type ChatMessage, type PresenceState } from "@lagekatse/shared";
import type { Session } from "../session";
import { connectModule, type ModuleConnection } from "./provider";

const COLORS = ["#2f6bd8", "#d5372b", "#2e9e5b", "#e08a1e", "#7c5ad8", "#0e9aa7", "#c2477f"];

function colorFor(sid: string): string {
  let hash = 0;
  for (let i = 0; i < sid.length; i++) hash = (hash * 31 + sid.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export interface RoomChat {
  messages: ChatMessage[];
  online: PresenceState[];
  connected: boolean;
  canChat: boolean;
  send: (body: string) => void;
}

export function useRoomChat(session: Session): RoomChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<PresenceState[]>([]);
  const [connected, setConnected] = useState(false);
  const connRef = useRef<ModuleConnection | null>(null);

  const canChat = canWrite(session.roles, "chat", {
    allowMonitorChat: session.room.settings.allowMonitorChat,
  });

  useEffect(() => {
    const conn = connectModule(session.room.id, "chat", session.token);
    connRef.current = conn;

    const arr = conn.doc.getArray<ChatMessage>(CHAT_ARRAY);
    const refreshMessages = () => setMessages(arr.toArray());
    arr.observe(refreshMessages);
    refreshMessages();

    const awareness = conn.provider.awareness;
    const me: PresenceState = {
      sid: session.sid,
      name: session.name,
      roles: session.roles,
      color: colorFor(session.sid),
      since: Date.now(),
    };
    awareness.setLocalState(me);

    const refreshPresence = () => {
      const byId = new Map<string, PresenceState>();
      for (const state of awareness.getStates().values()) {
        const s = state as Partial<PresenceState>;
        if (s && typeof s.sid === "string") byId.set(s.sid, s as PresenceState);
      }
      setOnline([...byId.values()].sort((a, b) => a.since - b.since));
    };
    awareness.on("change", refreshPresence);
    refreshPresence();

    const onStatus = (event: { status: string }) => setConnected(event.status === "connected");
    conn.provider.on("status", onStatus);

    return () => {
      arr.unobserve(refreshMessages);
      awareness.off("change", refreshPresence);
      conn.provider.off("status", onStatus);
      awareness.setLocalState(null);
      conn.destroy();
      connRef.current = null;
    };
  }, [session.room.id, session.sid, session.token, session.name]);

  const send = (body: string) => {
    const conn = connRef.current;
    const text = body.trim();
    if (!conn || !text || !canChat) return;
    conn.doc.getArray<ChatMessage>(CHAT_ARRAY).push([
      {
        id: crypto.randomUUID(),
        authorName: session.name,
        authorRoles: session.roles,
        body: text,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return { messages, online, connected, canChat, send };
}
