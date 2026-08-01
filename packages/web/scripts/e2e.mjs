// Smoke test for the M0 sync engine + authoritative rights enforcement.
// Runs real Yjs clients against a running backend (default :8080):
//   1) a writer (S3) posts a chat message  -> observer must receive it
//   2) a monitor posts, in a room with allowMonitorChat=false -> must be DROPPED
//   3) ETB: server-authoritative POST /etb/entries -> monotonic lfdNr, MONITOR 403,
//      and the entries sync to a fresh etb client (hot-join of the server push).
//   4) Activity channel: the server bumps a per-module counter on changes and fans
//      it out read-only (drives the rail dots); client writes are dropped.
// Node 22+ provides a global WebSocket, which y-websocket uses automatically.
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
    body: JSON.stringify({ name: "E2E Lage", settings: { allowMonitorChat: false } }),
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

async function postEtb(code, token, body = {}) {
  return fetch(`${API}/api/rooms/${code}/etb/entries`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function connectDoc(roomId, token, module, key) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, module, doc, {
    params: { token },
    disableBc: true, // force all sync through the server (see provider.ts)
  });
  return { doc, provider, arr: doc.getArray(key) };
}
const connect = (roomId, token) => connectDoc(roomId, token, "chat", "messages");

function connectActivity(roomId, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, "activity", doc, {
    params: { token },
    disableBc: true,
  });
  return { doc, provider, counters: doc.getMap("counters"), summaries: doc.getMap("summaries") };
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

const bodies = (arr) => arr.toArray().map((m) => m.body);

async function main() {
  await waitHealth();
  const room = await createRoom();
  console.log(`room ${room.joinCode} · allowMonitorChat=${room.settings.allowMonitorChat}`);

  const writer = await join(room.joinCode, "Writer S3", ["S3"]);
  const monitor = await join(room.joinCode, "Beamer", ["MONITOR"]);
  const observer = await join(room.joinCode, "Obs S1", ["S1"]);

  const W = connect(room.id, writer.token);
  const M = connect(room.id, monitor.token);
  const O = connect(room.id, observer.token);

  await Promise.all([waitConnected(W.provider), waitConnected(M.provider), waitConnected(O.provider)]);
  await sleep(600);

  W.arr.push([{ id: "1", authorName: "Writer S3", authorRoles: ["S3"], body: "hello from S3", createdAt: new Date().toISOString() }]);
  await sleep(900);

  M.arr.push([{ id: "2", authorName: "Beamer", authorRoles: ["MONITOR"], body: "monitor blocked", createdAt: new Date().toISOString() }]);
  await sleep(900);

  const seen = bodies(O.arr);
  console.log("observer sees:", seen);
  console.log("monitor local:", bodies(M.arr));

  const test1 = seen.includes("hello from S3");
  const test2 = !seen.includes("monitor blocked");
  console.log(`[${test1 ? "PASS" : "FAIL"}] writer -> observer propagation`);
  console.log(`[${test2 ? "PASS" : "FAIL"}] monitor write blocked (read-only enforcement)`);

  // 3) hot-join: a client connecting AFTER msg1 must receive the existing history.
  const late = await join(room.joinCode, "Late S4", ["S4"]);
  const L = connect(room.id, late.token);
  await waitConnected(L.provider);
  await sleep(900);
  const lateSeen = bodies(L.arr);
  console.log("late joiner sees:", lateSeen);
  const test3 = lateSeen.includes("hello from S3") && !lateSeen.includes("monitor blocked");
  console.log(`[${test3 ? "PASS" : "FAIL"}] hot-join receives existing history`);

  // 4) ETB: server-authoritative entry creation + read-only enforcement on the new HTTP path.
  const e1 = await postEtb(room.joinCode, writer.token, { von: "Leitstelle", richtung: "E", inhalt: "Pegel steigt" });
  const e1body = await e1.json().catch(() => ({}));
  const e2 = await postEtb(room.joinCode, writer.token);
  const e2body = await e2.json().catch(() => ({}));
  const mBlocked = await postEtb(room.joinCode, monitor.token);
  const test4 =
    e1.status === 201 && e1body.entry?.lfdNr === 1 && e2.status === 201 && e2body.entry?.lfdNr === 2;
  const test5 = mBlocked.status === 403;
  console.log(`[${test4 ? "PASS" : "FAIL"}] ETB entries created with monotonic lfdNr (server-authoritative)`);
  console.log(`[${test5 ? "PASS" : "FAIL"}] ETB write blocked for MONITOR (403)`);

  // entries must reach a fresh etb client (WS fan-out + hot-join of the server-authored pushes).
  const ETB = connectDoc(room.id, observer.token, "etb", "entries");
  await waitConnected(ETB.provider);
  await sleep(900);
  const lfdNrs = ETB.arr.toArray().map((m) => m.get("lfdNr")).sort((a, b) => a - b);
  console.log("etb client sees lfdNr:", lfdNrs);
  const test6 = lfdNrs.length === 2 && lfdNrs[0] === 1 && lfdNrs[1] === 2;
  console.log(`[${test6 ? "PASS" : "FAIL"}] ETB entries sync to a fresh client (hot-join)`);
  ETB.provider.destroy();

  // 5) Activity channel: the server bumps a per-module counter on every change and
  // fans it out to read-only subscribers (drives the rail activity dots).
  await sleep(800); // clear the per-module bump throttle window
  const ACT = connectActivity(room.id, writer.token);
  await waitConnected(ACT.provider);
  await sleep(900); // hot-join the current counters
  const etbBefore = ACT.counters.get("etb") ?? 0;
  const chatSeen = (ACT.counters.get("chat") ?? 0) >= 1;
  await postEtb(room.joinCode, writer.token); // a fresh change -> bump
  await sleep(900);
  const etbAfter = ACT.counters.get("etb") ?? 0;
  const etbSummary = ACT.summaries.get("etb");
  console.log("activity counters:", JSON.stringify(ACT.counters.toJSON()), "· etb summary:", JSON.stringify(etbSummary));
  const test7 = chatSeen && etbAfter > etbBefore;
  console.log(`[${test7 ? "PASS" : "FAIL"}] activity channel bumps + syncs (chat seen=${chatSeen}, etb ${etbBefore}->${etbAfter})`);
  const test9 = typeof etbSummary === "string" && etbSummary.startsWith("Neuer Eintrag · Lfd.");
  console.log(`[${test9 ? "PASS" : "FAIL"}] activity summary carries the ETB change (drives notification text)`);

  // Read-only: a client write to the activity channel must be dropped server-side.
  ACT.counters.set("etb", 9999);
  await sleep(700);
  const FRESH = connectActivity(room.id, writer.token);
  await waitConnected(FRESH.provider);
  await sleep(900);
  const freshEtb = FRESH.counters.get("etb") ?? 0;
  const test8 = freshEtb !== 9999;
  console.log(`[${test8 ? "PASS" : "FAIL"}] activity channel is read-only for clients (fresh reader etb=${freshEtb})`);
  ACT.provider.destroy();
  FRESH.provider.destroy();

  W.provider.destroy();
  M.provider.destroy();
  O.provider.destroy();
  L.provider.destroy();
  await sleep(150);

  process.exit(test1 && test2 && test3 && test4 && test5 && test6 && test7 && test8 && test9 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
