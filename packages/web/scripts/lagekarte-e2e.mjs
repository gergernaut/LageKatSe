// Smoke test for the M1 Step 2a `lagekarte` module against a running backend.
// Verifies: an S3 writer's SymbolFeature/AreaFeature in the features Y.Map
// propagate to another client, and a Monitor's write is blocked server-side.
// Uses its OWN throwaway room (does not touch any existing room).
//   API=http://<host>:<port> node packages/web/scripts/lagekarte-e2e.mjs
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
    body: JSON.stringify({ name: "Lagekarte E2E" }),
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
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, "lagekarte", doc, {
    params: { token },
    disableBc: true, // force all sync through the server (rights enforcement)
  });
  return { doc, provider, map: doc.getMap("features") };
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

async function main() {
  await waitHealth();
  const room = await createRoom();
  console.log(`room ${room.joinCode}`);

  const writer = await join(room.joinCode, "Writer S3", ["S3"]);
  const observer = await join(room.joinCode, "Obs S1", ["S1"]);
  const monitor = await join(room.joinCode, "Beamer", ["MONITOR"]);

  const W = connect(room.id, writer.token);
  const O = connect(room.id, observer.token);
  const M = connect(room.id, monitor.token);
  await Promise.all([waitConnected(W.provider), waitConnected(O.provider), waitConnected(M.provider)]);
  await sleep(600);

  const now = new Date().toISOString();
  W.map.set("s1", {
    id: "s1", kind: "symbol", symbolId: "Feuerwehr_Fahrzeuge/Loeschfahrzeug",
    position: [51.16, 10.45], rotation: 0, label: "LF", description: "Testzeichen",
    createdBy: "Writer S3", createdAt: now, updatedAt: now,
  });
  W.map.set("a1", {
    id: "a1", kind: "area", shape: "polygon",
    geometry: [[51.1, 10.3], [51.2, 10.3], [51.2, 10.5]],
    color: "#d5372b", opacity: 0.3, description: "Schadensgebiet",
    createdBy: "Writer S3", createdAt: now, updatedAt: now,
  });
  await sleep(900);

  const seen = [...O.map.keys()].sort();
  console.log("observer sieht:", seen);
  const test1 = seen.includes("s1") && seen.includes("a1");

  // Monitor tries to write a feature — must be dropped server-side.
  M.map.set("m1", {
    id: "m1", kind: "symbol", symbolId: "x/y", position: [51, 10], rotation: 0,
    createdBy: "Beamer", createdAt: now, updatedAt: now,
  });
  await sleep(900);
  const after = [...O.map.keys()].sort();
  console.log("nach Monitor-Write:", after);
  const test2 = !after.includes("m1");

  console.log(`[${test1 ? "PASS" : "FAIL"}] S3 setzt Symbol+Fläche → Observer sieht sie (Sync)`);
  console.log(`[${test2 ? "PASS" : "FAIL"}] Monitor-Write auf lagekarte blockiert (Rechte)`);

  W.provider.destroy();
  O.provider.destroy();
  M.provider.destroy();
  await sleep(150);
  process.exit(test1 && test2 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
