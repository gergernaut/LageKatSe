// Smoke test for the `kraefteubersicht` module (#100) against a running backend.
// Verifies: an S3 writer's vehicle row (vehicles Y.Array of Y.Map) and a status
// move propagate to another client; a Monitor's write is blocked server-side.
// (Kräftebewegungen landen seit #227 in einer client-CRDT-Historie, nicht mehr
// im ETB — der frühere /kraft/etb-log-Endpoint entfällt.)
// Uses its OWN throwaway room. Keys mirror shared's KRAFT_VEHICLES ("vehicles").
//   API=http://<host>:<port> node packages/web/scripts/kraefteubersicht-e2e.mjs
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
    body: JSON.stringify({ name: "Kräfteübersicht E2E" }),
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


function connect(roomId, token, module) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, module, doc, {
    params: { token },
    disableBc: true, // force all sync through the server (rights enforcement)
  });
  return { doc, provider };
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

function newVehicle(fields) {
  const map = new Y.Map();
  for (const [k, v] of Object.entries(fields)) map.set(k, v);
  return map;
}

async function main() {
  await waitHealth();
  const room = await createRoom();
  console.log(`room ${room.joinCode}`);

  const writer = await join(room.joinCode, "Writer S3", ["S3"]);
  const observer = await join(room.joinCode, "Obs S1", ["S1"]);
  const monitor = await join(room.joinCode, "Beamer", ["MONITOR"]);

  const W = connect(room.id, writer.token, "kraefteubersicht");
  const O = connect(room.id, observer.token, "kraefteubersicht");
  const M = connect(room.id, monitor.token, "kraefteubersicht");
  const Oetb = connect(room.id, observer.token, "etb");
  await Promise.all([
    waitConnected(W.provider),
    waitConnected(O.provider),
    waitConnected(M.provider),
    waitConnected(Oetb.provider),
  ]);
  await sleep(600);

  const wVehicles = W.doc.getArray("vehicles");
  const oVehicles = O.doc.getArray("vehicles");
  const mVehicles = M.doc.getArray("vehicles");

  // Writer (S3) adds a vehicle to the Bereitstellungsraum.
  wVehicles.push([
    newVehicle({
      id: "v1",
      org: "FW",
      typ: "LF 20",
      funkrufname: "Florian 1/44/1",
      fuehrer: 1,
      unterfuehrer: 2,
      helfer: 6,
      status: "br",
      createdAt: "2026-08-18T10:00:00.000Z",
      updatedAt: "2026-08-18T10:00:00.000Z",
    }),
  ]);
  await sleep(800);

  const seen = oVehicles.length === 1 ? oVehicles.get(0) : null;
  const test1 = !!seen && seen.get("funkrufname") === "Florian 1/44/1" && seen.get("status") === "br";
  console.log(`[${test1 ? "PASS" : "FAIL"}] S3 legt Fahrzeug an → Observer sieht es (Sync)`);

  // Move BR → Einsatz (single status field write).
  wVehicles.get(0).set("status", "einsatz");
  await sleep(800);
  const test2 = oVehicles.length === 1 && oVehicles.get(0).get("status") === "einsatz";
  console.log(`[${test2 ? "PASS" : "FAIL"}] Verschieben BR→Einsatz (Status-Feld) synchronisiert`);

  // Monitor tries to add a vehicle — must be dropped server-side.
  mVehicles.push([newVehicle({ id: "hack", org: "FW", typ: "HACK", funkrufname: "x", fuehrer: 0, unterfuehrer: 0, helfer: 0, status: "br" })]);
  await sleep(800);
  const test3 = oVehicles.length === 1;
  console.log(`[${test3 ? "PASS" : "FAIL"}] Monitor-Write auf kraefteubersicht blockiert (Rechte)`);

  W.provider.destroy();
  O.provider.destroy();
  M.provider.destroy();
  Oetb.provider.destroy();
  await sleep(150);
  process.exit(test1 && test2 && test3 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
