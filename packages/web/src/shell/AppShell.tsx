import { lazy, Suspense, useEffect, useState } from "react";
import { MODULE_LABELS } from "@lagekatse/shared";
import type { Session } from "../session";
import { useRoomChat } from "../sync/useRoomChat";
import { Uebersicht } from "../uebersicht/Uebersicht";

const Lagekarte = lazy(() => import("../lagekarte/Lagekarte").then((m) => ({ default: m.Lagekarte })));
const Etb = lazy(() => import("../etb/Etb").then((m) => ({ default: m.Etb })));

const ACTIVE_VIEW_KEY = "lagekatse.activeView";

export type ActiveView = "uebersicht" | "lagekarte" | "etb" | "arbeitsblatt";

const VIEWS: ActiveView[] = ["uebersicht", "lagekarte", "etb", "arbeitsblatt"];

function loadActiveView(): ActiveView {
  try {
    const stored = sessionStorage.getItem(ACTIVE_VIEW_KEY);
    return VIEWS.includes(stored as ActiveView) ? (stored as ActiveView) : "uebersicht";
  } catch {
    return "uebersicht";
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

function Placeholder({ view }: { view: "arbeitsblatt" }) {
  return (
    <div className="shell-placeholder">
      <span className="eyebrow">Modul</span>
      <h1>{MODULE_LABELS[view]}</h1>
      <p>In Kürze</p>
    </div>
  );
}

export function AppShell({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [activeView, setActiveView] = useState<ActiveView>(loadActiveView);
  const chat = useRoomChat(session);

  useEffect(() => {
    try {
      sessionStorage.setItem(ACTIVE_VIEW_KEY, activeView);
    } catch {
      /* storage unavailable — keep the active view in memory only */
    }
  }, [activeView]);

  return (
    <div className="app">
      <nav className="rail" aria-label="Module">
        <div className="rail__mark" aria-hidden="true">
          L
        </div>
        {VIEWS.map((view) => {
          const full = viewLabel(view);
          return (
            <button
              className={`rail__item ${activeView === view ? "is-active" : ""}`}
              type="button"
              key={view}
              title={full}
              aria-label={full}
              aria-current={activeView === view ? "page" : undefined}
              onClick={() => setActiveView(view)}
            >
              <ViewIcon view={view} />
              <span>{RAIL_LABELS[view]}</span>
            </button>
          );
        })}
        <div className="rail__spacer" />
        <div className="rail__user" title={`${session.name} · ${session.roles.join(" · ")}`}>
          <div className="rail__avatar">{initials(session.name)}</div>
          <span>{session.roles.join(" · ")}</span>
        </div>
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
          <span className={`dot ${chat.connected ? "dot--ok" : "dot--off"}`} />
          {chat.connected ? "Live synchronisiert" : "Verbinde…"}
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
        {activeView === "arbeitsblatt" && <Placeholder view="arbeitsblatt" />}
      </main>
    </div>
  );
}
