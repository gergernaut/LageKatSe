// Smoke test for the M3 `arbeitsblatt` module against a running backend.
// Verifies: an S3 writer's header field (kopf Y.Map) and a Führungsvorgang row
// (fuehrungsvorgang Y.Array of Y.Map) propagate to another client, and a
// Monitor's write is blocked server-side. Uses its OWN throwaway room.
// The keys mirror shared's AB_KOPF / AB_FUEHRUNG constants ("kopf"/"fuehrungsvorgang").
//   API=http://<host>:<port> node packages/web/scripts/arbeitsblatt-e2e.mjs
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
    body: JSON.stringify({ name: "Arbeitsblatt E2E" }),
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
  const provider = new WebsocketProvider(`${WS}/sync/${roomId}`, "arbeitsblatt", doc, {
    params: { token },
    disableBc: true, // force all sync through the server (rights enforcement)
  });
  return {
    doc,
    provider,
    kopf: doc.getMap("kopf"),
    fuehrung: doc.getArray("fuehrungsvorgang"),
    gefahren: doc.getMap("gefahren"),
    wetter: doc.getMap("wetter"),
  };
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

  // Writer (S3) fills a header field and appends a Führungsvorgang row.
  W.kopf.set("einsatzstichwort", "Wohnungsbrand B3");
  const row = new Y.Map();
  row.set("id", "r1");
  row.set("bedrohtesObjekt", "Person im 2. OG");
  row.set("wirkung", "Rauchgas");
  row.set("prioritaet", 1);
  row.set("massnahmen", "Menschenrettung");
  row.set("erledigt", false);
  W.fuehrung.push([row]);
  // Feld B: mark a hazard (gefahren Y.Map, whole-value posten).
  W.gefahren.set("atemgifte", { betroffen: true, notiz: "Rauchgas" });
  // Rückseite: Wetter-Snapshot als atomarer Whole-Value-Posten unter "snapshot".
  W.wetter.set("snapshot", {
    fetchedAt: "2026-08-07T09:30:00.000Z",
    lat: 51.5,
    lon: 7.5,
    stationName: "Dortmund",
    current: { temperature: 18, windSpeed: 12, windDirection: 225, windGust: 25, precipitation: 0, cloudCover: 25, pressure: 1022, humidity: 66, condition: "dry", icon: "partly-cloudy-day" },
    forecast: [],
    alerts: [],
  });
  await sleep(900);

  const stichwort = O.kopf.get("einsatzstichwort");
  const firstRow = O.fuehrung.length > 0 ? O.fuehrung.get(0) : null;
  const bedroht = firstRow ? firstRow.get("bedrohtesObjekt") : null;
  const gefahr = O.gefahren.get("atemgifte");
  const wetter = O.wetter.get("snapshot");
  console.log("observer sieht:", { stichwort, rows: O.fuehrung.length, bedroht, gefahr, wetter });
  const test1 =
    stichwort === "Wohnungsbrand B3" &&
    O.fuehrung.length === 1 &&
    bedroht === "Person im 2. OG" &&
    !!gefahr &&
    gefahr.betroffen === true;
  const test3 =
    !!wetter && wetter.stationName === "Dortmund" && wetter.current?.temperature === 18;

  // Monitor tries to overwrite the header field AND the weather snapshot — both
  // must be dropped server-side.
  M.kopf.set("einsatzstichwort", "MONITOR HACK");
  M.wetter.set("snapshot", { stationName: "HACK" });
  await sleep(900);
  const afterHack = O.kopf.get("einsatzstichwort");
  const wetterAfterHack = O.wetter.get("snapshot");
  console.log("nach Monitor-Write:", { afterHack, station: wetterAfterHack?.stationName });
  const test2 = afterHack === "Wohnungsbrand B3" && wetterAfterHack?.stationName === "Dortmund";

  console.log(`[${test1 ? "PASS" : "FAIL"}] S3 setzt Kopf-Feld + Führungsvorgang-Zeile + Gefahr → Observer sieht sie (Sync)`);
  console.log(`[${test3 ? "PASS" : "FAIL"}] S3 setzt Wetter-Snapshot → Observer sieht ihn (Sync)`);
  console.log(`[${test2 ? "PASS" : "FAIL"}] Monitor-Write auf arbeitsblatt (Kopf + Wetter) blockiert (Rechte)`);

  W.provider.destroy();
  O.provider.destroy();
  M.provider.destroy();
  await sleep(150);
  process.exit(test1 && test2 && test3 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
