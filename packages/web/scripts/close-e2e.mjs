// Smoke test for "Lage abschließen" (#75): the server-authoritative
// POST /api/rooms/:code/close endpoint (RoomHub.closeRoom).
//   1) create room, join as S3 → POST /close → 200 { ok: true }
//   2) afterwards GET /api/rooms/:code → 404 (room deleted)
//   3) role gate: a non-Stab role (MONITOR) gets 403 (on a fresh room)
// Node 22+.
const API = process.env.API ?? "http://localhost:8080";
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
    body: JSON.stringify({ name: "Close E2E", createdBy: "Ersteller (S3)" }),
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

// Spiegelt den echten Client (api.closeRoom): content-type json + leerer Body {}.
const close = (code, token) =>
  fetch(`${API}/api/rooms/${code}/close`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });

async function main() {
  await waitHealth();

  // Room A: S3 schließt erfolgreich.
  const roomA = await createRoom();
  const stab = await join(roomA.joinCode, "Chef S3", ["S3"]);
  const okRes = await close(roomA.joinCode, stab.token);
  const okBody = await okRes.json().catch(() => ({}));
  const test1 = okRes.status === 200 && okBody.ok === true;
  console.log(`[${test1 ? "PASS" : "FAIL"}] S3 close → 200 ok (got ${okRes.status}/${JSON.stringify(okBody)})`);

  await sleep(300);
  const gone = await fetch(`${API}/api/rooms/${roomA.joinCode}`);
  const test2 = gone.status === 404;
  console.log(`[${test2 ? "PASS" : "FAIL"}] Raum danach gelöscht → GET 404 (got ${gone.status})`);

  // Room B: MONITOR (keine Stabsrolle) darf nicht schließen.
  const roomB = await createRoom();
  const monitor = await join(roomB.joinCode, "Beamer", ["MONITOR"]);
  const blocked = await close(roomB.joinCode, monitor.token);
  const test3 = blocked.status === 403;
  console.log(`[${test3 ? "PASS" : "FAIL"}] MONITOR close blockiert → 403 (got ${blocked.status})`);
  // Raum B existiert noch (nicht geschlossen).
  const stillThere = await fetch(`${API}/api/rooms/${roomB.joinCode}`);
  const test4 = stillThere.status === 200;
  console.log(`[${test4 ? "PASS" : "FAIL"}] Raum B nach 403 noch vorhanden → GET 200 (got ${stillThere.status})`);

  process.exit(test1 && test2 && test3 && test4 ? 0 : 1);
}

main().catch((err) => {
  console.error("close e2e error:", err);
  process.exit(2);
});
