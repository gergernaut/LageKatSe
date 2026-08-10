import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MODULE_LABELS, type ActivityCounters, type Module } from "@lagekatse/shared";
import type { Session } from "../session";
import { useActivityNotifications } from "../sync/useActivityNotifications";
import { useActivityTitle } from "../sync/useActivityTitle";
import { useRoomActivity } from "../sync/useRoomActivity";
import { useRoomChat } from "../sync/useRoomChat";
import { Uebersicht } from "../uebersicht/Uebersicht";

const Lagekarte = lazy(() => import("../lagekarte/Lagekarte").then((m) => ({ default: m.Lagekarte })));
const Etb = lazy(() => import("../etb/Etb").then((m) => ({ default: m.Etb })));
const Arbeitsblatt = lazy(() =>
  import("../arbeitsblatt/Arbeitsblatt").then((m) => ({ default: m.Arbeitsblatt })),
);

const ACTIVE_VIEW_KEY = "lagekatse.activeView";
const NOTIFICATIONS_KEY = "lagekatse.notifications";

export type ActiveView = "uebersicht" | "lagekarte" | "etb" | "arbeitsblatt";

const VIEWS: ActiveView[] = ["uebersicht", "lagekarte", "etb", "arbeitsblatt"];

const RAIL_ACTIVITY: Record<ActiveView, Module> = {
  uebersicht: "chat",
  lagekarte: "lagekarte",
  etb: "etb",
  arbeitsblatt: "arbeitsblatt",
};

function activitySeenKey(roomId: string): string {
  return `lagekatse.activitySeen.${roomId}`;
}

function loadActivitySeen(roomId: string): ActivityCounters {
  try {
    const raw = localStorage.getItem(activitySeenKey(roomId));
    if (!raw) return {};
    const stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

    const counters: ActivityCounters = {};
    for (const module of Object.values(RAIL_ACTIVITY)) {
      const value = (stored as Record<string, unknown>)[module];
      if (typeof value === "number" && Number.isFinite(value)) counters[module] = value;
    }
    return counters;
  } catch {
    return {};
  }
}

function saveActivitySeen(roomId: string, seen: ActivityCounters): void {
  try {
    localStorage.setItem(activitySeenKey(roomId), JSON.stringify(seen));
  } catch {
    /* storage unavailable — keep seen counters in memory only */
  }
}

/** Whether this room already has a persisted "seen" state (the user has been here
 *  before) — decides whether to baseline on a fresh join. */
function hasStoredSeen(roomId: string): boolean {
  try {
    return localStorage.getItem(activitySeenKey(roomId)) !== null;
  } catch {
    return false;
  }
}

function loadActiveView(): ActiveView {
  try {
    const stored = sessionStorage.getItem(ACTIVE_VIEW_KEY);
    return VIEWS.includes(stored as ActiveView) ? (stored as ActiveView) : "uebersicht";
  } catch {
    return "uebersicht";
  }
}

function loadNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_KEY) === "true";
  } catch {
    return false;
  }
}

function saveNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
  } catch {
    /* storage unavailable — keep the notification preference in memory only */
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function ViewIcon({ view }: { view: ActiveView }) {
  if (view === "uebersicht") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }
  if (view === "lagekarte") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m9 4-6 3v13l6-3 6 3 6-3V4l-6 3-6-3Z" />
        <path d="M9 4v13M15 7v13" />
      </svg>
    );
  }
  if (view === "etb") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" />
        <path d="M8 7h7M8 11h7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2.5h6V4M8 10h8M8 14h5" />
    </svg>
  );
}

function NotificationIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM9.8 20h4.4a2.5 2.5 0 0 1-4.4 0Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M13.7 3.2A6 6 0 0 0 6 8c0 2.1-.3 3.5-.8 4.6M4 17h17c0-2-3-2-3-9 0-.4 0-.8-.1-1.1M9.8 20h4.4a2.5 2.5 0 0 1-4.4 0ZM3 3l18 18" />
    </svg>
  );
}

function viewLabel(view: ActiveView): string {
  return view === "uebersicht" ? "Übersicht" : MODULE_LABELS[view];
}

// Kurze, in die schmale Rail passende Beschriftungen (der volle Name steht im
// title/aria-label). "takt. Arbeitsblatt" bricht in der Rail auf zwei Zeilen um.
const RAIL_LABELS: Record<ActiveView, string> = {
  uebersicht: "Übersicht",
  lagekarte: "Lagekarte",
  etb: "ETB",
  arbeitsblatt: "takt. Arbeitsblatt",
};

export function AppShell({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [activeView, setActiveView] = useState<ActiveView>(loadActiveView);
  const [seen, setSeen] = useState<ActivityCounters>(() => loadActivitySeen(session.room.id));
  const [notificationsEnabled, setNotificationsEnabled] = useState(loadNotificationsEnabled);
  const chat = useRoomChat(session);
  const { counters: activity, summaries, synced } = useRoomActivity(session);
  // Baseline "seen" to the server's current counters on the first sync of a fresh
  // join (no prior seen) so pre-existing activity does not dot.
  const hadStoredSeenRef = useRef<boolean | null>(null);
  if (hadStoredSeenRef.current === null) hadStoredSeenRef.current = hasStoredSeen(session.room.id);
  const baselinedRef = useRef(false);
  const [baselineApplied, setBaselineApplied] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVE_VIEW_KEY, activeView);
    } catch {
      /* storage unavailable — keep the active view in memory only */
    }
  }, [activeView]);

  useEffect(() => {
    // Only touch "seen" once the counters are authoritative. Before the initial
    // sync (and during a reconnect) `activity` is a transient {} — clamping seen
    // against it would wrongly resurrect dots.
    if (!synced) return;
    // Baseline once on a fresh join: adopt the current server counters so
    // pre-existing activity does not dot. Returning users keep their stored seen.
    // Side effects (ref, baselineApplied) stay OUT of the updater so it is pure
    // under StrictMode's double-invoke.
    const baseline = !baselinedRef.current && !hadStoredSeenRef.current;
    baselinedRef.current = true;
    setSeen((current) => {
      const next = baseline ? { ...activity } : { ...current };
      // Counter regression (server restart resets counters) — clamp seen down.
      for (const module of Object.values(RAIL_ACTIVITY)) {
        const count = activity[module] ?? 0;
        if (count < (next[module] ?? 0)) next[module] = count;
      }
      // Active module always counts as seen (clears its dot on open; own edits
      // made while viewing never dot).
      next[RAIL_ACTIVITY[activeView]] = activity[RAIL_ACTIVITY[activeView]] ?? 0;
      return next;
    });
    setBaselineApplied(true);
  }, [activeView, activity, synced, session.room.id]);

  // Persist "seen" whenever it changes — kept out of the updater above so that
  // stays pure. Only after baseline, so a fresh join never writes an empty {}.
  useEffect(() => {
    if (baselineApplied) saveActivitySeen(session.room.id, seen);
  }, [seen, baselineApplied, session.room.id]);

  useActivityNotifications({
    session,
    messages: chat.messages,
    counters: activity,
    summaries,
    activeView,
    setActiveView,
    enabled: notificationsEnabled,
    ready: synced && baselineApplied,
  });

  // Tab-title activity indicator — always on (like the rail dots). Works over
  // plain http; the opt-in OS notifications above only fire in a secure context.
  useActivityTitle(activity, seen);

  const notificationsSupported = typeof Notification !== "undefined";
  const notificationPermission = notificationsSupported ? Notification.permission : null;
  const notificationsActive = notificationsEnabled && notificationPermission === "granted";
  const notificationTitle = !notificationsSupported
    ? "Desktop-Benachrichtigungen brauchen HTTPS/localhost — die Aktivität siehst du im Tab-Titel"
    : notificationPermission === "denied"
      ? "Desktop-Benachrichtigungen im Browser blockiert"
      : notificationsActive
        ? "Desktop-Benachrichtigungen ausschalten"
        : "Desktop-Benachrichtigungen einschalten";

  const toggleNotifications = async () => {
    if (!notificationsSupported) return;
    if (notificationsActive) {
      setNotificationsEnabled(false);
      saveNotificationsEnabled(false);
      return;
    }

    let permission = Notification.permission;
    try {
      if (permission === "default") permission = await Notification.requestPermission();
    } catch {
      permission = "denied";
    }
    const enabled = permission === "granted";
    setNotificationsEnabled(enabled);
    saveNotificationsEnabled(enabled);
  };

  return (
    <div className="app">
      <nav className="rail" aria-label="Module">
        <img className="rail__mark" src="/lagekatse_logo.png" alt="LageKatSe" aria-hidden="true" />
        {VIEWS.map((view) => {
          const full = viewLabel(view);
          const module = RAIL_ACTIVITY[view];
          const hasActivity =
            baselineApplied && view !== activeView && (activity[module] ?? 0) > (seen[module] ?? 0);
          const accessibleLabel = hasActivity ? `${full} · neue Aktivität` : full;
          return (
            <button
              className={`rail__item ${activeView === view ? "is-active" : ""}`}
              type="button"
              key={view}
              title={accessibleLabel}
              aria-label={accessibleLabel}
              aria-current={activeView === view ? "page" : undefined}
              onClick={() => setActiveView(view)}
            >
              <ViewIcon view={view} />
              {hasActivity && <span className="rail__dot" aria-hidden="true" />}
              <span>{RAIL_LABELS[view]}</span>
            </button>
          );
        })}
        <div className="rail__spacer" />
        <div className="rail__user" title={`${session.name} · ${session.roles.join(" · ")}`}>
          <div className="rail__avatar">{initials(session.name)}</div>
          <span>{session.roles.join(" · ")}</span>
        </div>
        <button
          className={`rail__item rail__notifications ${notificationsActive ? "is-enabled" : ""}`}
          type="button"
          title={notificationTitle}
          aria-label={notificationTitle}
          aria-pressed={notificationsActive}
          disabled={!notificationsSupported}
          onClick={toggleNotifications}
        >
          <NotificationIcon enabled={notificationsActive} />
          <span>Meldungen</span>
        </button>
        <button className="rail__item rail__exit" type="button" title="Stabsraum verlassen" onClick={onLeave}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          <span>Exit</span>
        </button>
      </nav>

      <header className="topbar">
        <div className="room">
          <b>{session.room.name}</b>
        </div>
        <span className="chip chip--code">⬡ {session.room.joinCode}</span>
        <span className="role-badge">◆ {session.roles.join(" · ")}</span>
        <div className="spacer" />
        <span className="live">
          <span className={`dot ${
            chat.connectionStatus === "connected" ? "dot--ok"
            : chat.connectionStatus === "disconnected" ? "dot--off"
            : "dot--warn"
          }`} />
          {chat.connectionStatus === "connected" ? "Live synchronisiert"
          : chat.connectionStatus === "disconnected" ? "Offline — lokal zwischengespeichert"
          : "Verbinde…"}
        </span>
        <button className="btn btn--ghost topbar__leave" type="button" onClick={onLeave}>
          Verlassen
        </button>
      </header>

      <main
        className={`canvas ${
          activeView === "lagekarte" ? "canvas--lagekarte" : activeView === "etb" ? "canvas--work" : ""
        }`}
      >
        {activeView === "uebersicht" && (
          <Uebersicht
            session={session}
            messages={chat.messages}
            online={chat.online}
            connected={chat.connected}
            connectionStatus={chat.connectionStatus}
            canChat={chat.canChat}
            send={chat.send}
            onOpenModule={setActiveView}
          />
        )}
        {activeView === "lagekarte" && (
          <Suspense fallback={<div className="shell-loading">Karte wird geladen…</div>}>
            <Lagekarte session={session} />
          </Suspense>
        )}
        {activeView === "etb" && (
          <Suspense fallback={<div className="shell-loading">Einsatztagebuch wird geladen…</div>}>
            <Etb session={session} />
          </Suspense>
        )}
        {activeView === "arbeitsblatt" && (
          <Suspense fallback={<div className="shell-loading">Arbeitsblatt wird geladen…</div>}>
            <Arbeitsblatt session={session} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
