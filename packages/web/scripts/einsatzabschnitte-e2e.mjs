// Smoke test for the `einsatzabschnitte` module (#133) against a running backend.
// Verifies: an S3 writer's Einsatzabschnitt (abschnitte Y.Array of Y.Map) and a
// vehicle assignment (einsatzabschnittId on a kraefteubersicht vehicle) propagate
// to another client; the per-Abschnitt strength is derivable; and a Monitor's
// write to einsatzabschnitte is blocked server-side. Uses its OWN throwaway room.
// Keys mirror shared: EA_ABSCHNITTE ("abschnitte") / KRAFT_VEHICLES ("vehicles").
//   API=http://<host>:<port> node packages/web/scripts/einsatzabschnitte-e2e.mjs
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
    body: JSON.stringify({ name: "Einsatzabschnitte E2E" }),
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

function eaRow(fields) {
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

  // Writer + observer connect to BOTH docs; monitor only needs einsatzabschnitte.
  const We = connect(room.id, writer.token, "einsatzabschnitte");
  const Wk = connect(room.id, writer.token, "kraefteubersicht");
  const Oe = connect(room.id, observer.token, "einsatzabschnitte");
  const Ok = connect(room.id, observer.token, "kraefteubersicht");
  const Me = connect(room.id, monitor.token, "einsatzabschnitte");
  await Promise.all(
    [We, Wk, Oe, Ok, Me].map((c) => waitConnected(c.provider)),
  );
  await sleep(600);

  // S3 legt einen Einsatzabschnitt an und ordnet ihm ein Einsatz-Fahrzeug zu.
  We.doc.getArray("abschnitte").push([
    eaRow({
      id: "ea1",
      typ: "EA",
      titel: "A",
      befehlsstelle: "FW 1",
      leiter: "B-Dienst",
      kommunikation: "Florian 1",
      auftrag: "Menschenrettung",
      einsatzbeginn: "260918Aug26",
      createdAt: "2026-08-26T09:18:00.000Z",
    }),
  ]);
  Wk.doc.getArray("vehicles").push([
    eaRow({
      id: "v1",
      org: "FW",
      typ: "HLF 20",
      funkrufname: "Florian OWL 1-44-1",
      fuehrer: 1,
      unterfuehrer: 0,
      helfer: 5,
      status: "einsatz",
      einsatzabschnittId: "ea1",
      createdAt: "2026-08-26T09:18:00.000Z",
      updatedAt: "2026-08-26T09:18:00.000Z",
    }),
  ]);

  // Führung (#154): Singleton-Y.Map "fuehrung" + Führungsmittel via reservierter
  // einsatzabschnittId "fuehrung" (kein echter Abschnitt).
  const wf = We.doc.getMap("fuehrung");
  wf.set("fuehrer", "EL Muster");
  wf.set("befehlsstelle", "FüKW");
  wf.set("kommunikation", "Florian 10");
  wf.set("standort", "Rathausplatz");
  Wk.doc.getArray("vehicles").push([
    eaRow({
      id: "v2",
      org: "FW",
      typ: "ELW 1",
      funkrufname: "Florian OWL 1-11-1",
      fuehrer: 1,
      unterfuehrer: 1,
      helfer: 1,
      status: "einsatz",
      einsatzabschnittId: "fuehrung",
      createdAt: "2026-08-26T09:18:00.000Z",
      updatedAt: "2026-08-26T09:18:00.000Z",
    }),
  ]);
  await sleep(900);

  // Observer: sieht Abschnitt + zugeordnetes Fahrzeug, Stärke ableitbar.
  const oa = Oe.doc.getArray("abschnitte");
  const ov = Ok.doc.getArray("vehicles");
  const abschnitt = oa.length > 0 ? oa.get(0).toJSON() : null;
  const assigned = ov.toArray().map((v) => v.toJSON()).filter((v) => v.status === "einsatz" && v.einsatzabschnittId === "ea1");
  const staerke = assigned.reduce(
    (a, v) => ({ f: a.f + (v.fuehrer || 0), u: a.u + (v.unterfuehrer || 0), h: a.h + (v.helfer || 0) }),
    { f: 0, u: 0, h: 0 },
  );
  const staerkeStr = `${staerke.f}/${staerke.u}/${staerke.h}//${staerke.f + staerke.u + staerke.h}`;
  console.log("observer sieht:", { abschnitt, assignedCount: assigned.length, staerke: staerkeStr });
  const test1 =
    !!abschnitt && abschnitt.titel === "A" && abschnitt.typ === "EA" &&
    assigned.length === 1 && assigned[0].funkrufname === "Florian OWL 1-44-1" && staerkeStr === "1/0/5//6";

  // Führung: Observer sieht den Singleton + das Führungsmittel (Stärke ableitbar).
  const of = Oe.doc.getMap("fuehrung").toJSON();
  const fuAssigned = ov.toArray().map((v) => v.toJSON()).filter((v) => v.status === "einsatz" && v.einsatzabschnittId === "fuehrung");
  const fuStaerke = fuAssigned.reduce(
    (a, v) => ({ f: a.f + (v.fuehrer || 0), u: a.u + (v.unterfuehrer || 0), h: a.h + (v.helfer || 0) }),
    { f: 0, u: 0, h: 0 },
  );
  const fuStr = `${fuStaerke.f}/${fuStaerke.u}/${fuStaerke.h}//${fuStaerke.f + fuStaerke.u + fuStaerke.h}`;
  console.log("observer sieht Führung:", { fuehrung: of, fuAssignedCount: fuAssigned.length, staerke: fuStr });
  const test3 = of.fuehrer === "EL Muster" && of.standort === "Rathausplatz" && fuAssigned.length === 1 && fuStr === "1/1/1//3";

  // Monitor versucht, einen Abschnitt anzulegen — muss serverseitig verworfen werden.
  Me.doc.getArray("abschnitte").push([eaRow({ id: "hack", typ: "EA", titel: "MONITOR HACK" })]);
  await sleep(900);
  const titles = oa.toArray().map((m) => m.get("titel"));
  console.log("nach Monitor-Write, Abschnitte:", titles);
  const test2 = oa.length === 1 && !titles.includes("MONITOR HACK");

  console.log(`[${test1 ? "PASS" : "FAIL"}] S3 legt Abschnitt an + ordnet Fzg zu → Observer sieht ihn + Stärke 1/0/5//6 (Sync + Ableitung)`);
  console.log(`[${test3 ? "PASS" : "FAIL"}] Führung-Singleton + Führungsmittel synchron → Observer sieht ihn + Stärke 1/1/1//3 (#154)`);
  console.log(`[${test2 ? "PASS" : "FAIL"}] Monitor-Write auf einsatzabschnitte blockiert (Rechte)`);

  [We, Wk, Oe, Ok, Me].forEach((c) => c.provider.destroy());
  await sleep(150);
  process.exit(test1 && test2 && test3 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
