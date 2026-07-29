// Smoke test for the M0 sync engine + authoritative rights enforcement.
// Runs three real Yjs clients against a running backend (default :8080):
//   1) a writer (S3) posts a chat message  -> observer must receive it
//   2) a monitor posts, in a room with allowMonitorChat=false -> must be DROPPED
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

function connect(roomId, token) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, "chat", doc, {
    params: { token },
    disableBc: true, // force all sync through the server (see provider.ts)
  });
  return { doc, provider, arr: doc.getArray("messages") };
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

  W.provider.destroy();
  M.provider.destroy();
  O.provider.destroy();
  L.provider.destroy();
  await sleep(150);

  process.exit(test1 && test2 && test3 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
