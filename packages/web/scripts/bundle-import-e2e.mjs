// Smoke test for the Bundle-Import ETB path (#71): the server-authoritative
// POST /api/rooms/:code/etb/import (RoomHub.replaceEtbEntries).
//   1) create room, S3 posts 2 entries (lfdNr 1,2 via the normal endpoint)
//   2) import 3 entries with custom lfdNr (10,11,12) incl. a cancelled one
//      -> replaces the ETB; a fresh etb client sees exactly those 3, lfdNr +
//         storniert preserved (NOT the old 2)
//   3) role gate: MONITOR and a pure ETB (module) role get 403 — the import is
//      stricter than canWrite("etb") and requires a Stabsrolle (S1–S6)
// Node 22+ provides a global WebSocket (used by y-websocket).
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const API = process.env.API ?? "http://localhost:8080";
const WS = API.replace(/^http/, "ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${API}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("server did not become healthy");
}

async function createRoom() {
  const r = await fetch(`${API}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Bundle E2E", settings: { allowMonitorChat: false } }),
  });
  if (!r.ok) throw new Error(`create failed ${r.status}`);
  return (await r.json()).room;
}

async function join(code, name, roles) {
  const r = await fetch(`${API}/api/rooms/${code}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, roles }),
  });
  if (!r.ok) throw new Error(`join ${name} failed ${r.status}: ${await r.text()}`);
  return r.json();
}

const postEtb = (code, token, body = {}) =>
  fetch(`${API}/api/rooms/${code}/etb/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const importEtb = (code, token, entries) =>
  fetch(`${API}/api/rooms/${code}/etb/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ entries }),
  });

function connectEtb(roomId, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, "etb", doc, {
    params: { token },
    disableBc: true,
  });
  return { doc, provider, arr: doc.getArray("entries") };
}

function waitConnected(provider, ms = 5000) {
  return new Promise((resolve) => {
    if (provider.wsconnected) return resolve(true);
    const on = (e) => {
      if (e.status === "connected") {
        provider.off("status", on);
        resolve(true);
      }
    };
    provider.on("status", on);
    setTimeout(() => {
      provider.off("status", on);
      resolve(provider.wsconnected);
    }, ms);
  });
}

function entry(lfdNr, inhalt, extra = {}) {
  return {
    id: `imp-${lfdNr}`,
    lfdNr,
    zeit: "2026-08-03T17:48:00.000Z",
    richtung: "E",
    von: "Import",
    an: "",
    weg: "Funk",
    inhalt,
    veranlassung: "",
    erledigt: false,
    bearbeiter: "Bundle",
    ...extra,
  };
}

async function main() {
  await waitHealth();
  const room = await createRoom();
  const stab = await join(room.joinCode, "Chef S3", ["S3"]);
  const monitor = await join(room.joinCode, "Beamer", ["MONITOR"]);
  const etbRole = await join(room.joinCode, "ETB-Führer", ["ETB"]);
  console.log(`room ${room.joinCode}`);

  // 1) seed 2 entries via the normal (append) endpoint
  await postEtb(room.joinCode, stab.token, { inhalt: "alt 1" });
  await postEtb(room.joinCode, stab.token, { inhalt: "alt 2" });

  // 2) import 3 entries with custom lfdNr (unsorted on purpose) + one cancelled
  const payload = [
    entry(12, "import c", { storniert: true }),
    entry(10, "import a"),
    entry(11, "import b"),
  ];
  const imp = await importEtb(room.joinCode, stab.token, payload);
  const impBody = await imp.json().catch(() => ({}));
  const test1 = imp.status === 200 && impBody.count === 3;
  console.log(`[${test1 ? "PASS" : "FAIL"}] import returns count=3 (got ${imp.status}/${impBody.count})`);

  // fresh etb client must see EXACTLY the 3 imported entries (replace), sorted,
  // with lfdNr + storniert preserved.
  const C = connectEtb(room.id, stab.token);
  await waitConnected(C.provider);
  await sleep(900);
  const rows = C.arr.toArray().map((m) => ({ lfdNr: m.get("lfdNr"), inhalt: m.get("inhalt"), storniert: m.get("storniert") }));
  const lfdNrs = rows.map((r) => r.lfdNr);
  console.log("etb client sees:", JSON.stringify(rows));
  const test2 = rows.length === 3 && JSON.stringify(lfdNrs) === JSON.stringify([10, 11, 12]);
  console.log(`[${test2 ? "PASS" : "FAIL"}] ETB replaced: exactly 3 entries, lfdNr preserved + sorted`);
  const cancelled = rows.find((r) => r.lfdNr === 12);
  const test3 = cancelled?.storniert === true && !lfdNrs.includes(1) && !lfdNrs.includes(2);
  console.log(`[${test3 ? "PASS" : "FAIL"}] storniert preserved + old entries gone`);
  C.provider.destroy();

  // 3) role gate: non-Stab roles get 403
  const mBlocked = await importEtb(room.joinCode, monitor.token, payload);
  const etbBlocked = await importEtb(room.joinCode, etbRole.token, payload);
  const test4 = mBlocked.status === 403 && etbBlocked.status === 403;
  console.log(`[${test4 ? "PASS" : "FAIL"}] import blocked for non-Stab roles (MONITOR=${mBlocked.status}, ETB=${etbBlocked.status})`);

  await sleep(150);
  process.exit(test1 && test2 && test3 && test4 ? 0 : 1);
}

main().catch((err) => {
  console.error("bundle-import e2e error:", err);
  process.exit(2);
});
