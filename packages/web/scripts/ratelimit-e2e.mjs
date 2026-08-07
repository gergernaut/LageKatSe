// Smoke test for rate-limiting (#64) against a running backend.
// Floods the sensitive Lobby-Join endpoint with a bogus code and verifies that
// the limit kicks in (429) — without blocking the first requests.
// MUSS als LETZTER Smoke-Test laufen: er trippt das Join-Limit (Standard 30/min),
// wodurch weitere Joins aus derselben IP bis zum Fensterende 429 bekämen.
//   API=http://<host>:<port> node packages/web/scripts/ratelimit-e2e.mjs
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

async function main() {
  await waitHealth();

  const N = 45; // deutlich über dem Standard-Limit (30/min) für sensible Endpunkte
  const statuses = [];
  for (let i = 0; i < N; i++) {
    const r = await fetch(`${API}/api/rooms/ZZZZZZ/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Flood", roles: ["S1"] }),
    });
    statuses.push(r.status);
  }

  const limited = statuses.filter((s) => s === 429).length;
  const first = statuses[0];
  // Vor dem Limit liefert der Handler 404 (Bogus-Code) — NICHT 429.
  const test1 = first === 404;
  const test2 = limited > 0;

  console.log("Status-Folge:", statuses.join(","));
  console.log(`[${test1 ? "PASS" : "FAIL"}] Erste Anfrage nicht limitiert (Status ${first}, erwartet 404)`);
  console.log(`[${test2 ? "PASS" : "FAIL"}] Rate-Limit greift bei Flut (${limited}/${N} → 429)`);

  process.exit(test1 && test2 ? 0 : 1);
}

main().catch((err) => {
  console.error("e2e error:", err);
  process.exit(2);
});
