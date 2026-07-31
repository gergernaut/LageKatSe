import { useEffect, useRef } from "react";
import {
  MODULE_LABELS,
  type ActivityCounters,
  type ActivitySummaries,
  type ChatMessage,
} from "@lagekatse/shared";
import type { ActiveView } from "../shell/AppShell";
import type { Session } from "../session";

const NOTIFICATION_MODULES = ["etb", "lagekarte", "arbeitsblatt"] as const;

interface ActivityNotificationOptions {
  session: Session;
  messages: ChatMessage[];
  counters: ActivityCounters;
  summaries: ActivitySummaries;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  enabled: boolean;
  ready: boolean;
}

function canNotify(enabled: boolean): boolean {
  return (
    enabled &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    document.hidden
  );
}

export function useActivityNotifications({
  session,
  messages,
  counters,
  summaries,
  setActiveView,
  enabled,
  ready,
}: ActivityNotificationOptions): void {
  const prevCounters = useRef<ActivityCounters>({});
  const lastChatCount = useRef(0);
  const baselinedRef = useRef(false);

  useEffect(() => {
    if (!ready || baselinedRef.current) return;
    prevCounters.current = { ...counters };
    lastChatCount.current = messages.length;
    baselinedRef.current = true;
  }, [counters, messages.length, ready]);

  useEffect(() => {
    if (!baselinedRef.current) return;

    const previousCount = lastChatCount.current;
    const newMessages = messages.slice(previousCount);
    // Update before firing: a StrictMode replay sees no remaining delta.
    lastChatCount.current = messages.length;

    for (const message of newMessages) {
      if (message.authorName === session.name || !canNotify(enabled)) continue;
      const notification = new Notification(session.room.name, {
        body: `${message.authorName}: ${message.body}`,
      });
      notification.onclick = () => {
        window.focus();
        setActiveView("uebersicht");
        notification.close();
      };
    }
  }, [enabled, messages, session.name, session.room.name, setActiveView]);

  useEffect(() => {
    if (!baselinedRef.current) return;

    const changedModules = NOTIFICATION_MODULES.filter(
      (module) => (counters[module] ?? 0) > (prevCounters.current[module] ?? 0),
    );
    // Update before firing: a StrictMode replay sees no remaining delta.
    prevCounters.current = { ...counters };

    for (const module of changedModules) {
      if (!canNotify(enabled)) continue;
      const notification = new Notification(session.room.name, {
        body: summaries[module] || `Neue Aktivität: ${MODULE_LABELS[module]}`,
      });
      notification.onclick = () => {
        window.focus();
        setActiveView(module);
        notification.close();
      };
    }
  }, [counters, enabled, session.room.name, setActiveView, summaries]);
}
