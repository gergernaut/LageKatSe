import { describe, expect, it } from "vitest";
import { canWrite, effectiveWriteScopes, hasStabRole, ROLES, type Role } from "./roles";
import { MODULES, type Module } from "./modules";

const CHAT_ON = { allowMonitorChat: true };
const CHAT_OFF = { allowMonitorChat: false };

// Dies ist die serverseitig durchgesetzte Rechte-Matrix (Invariante #2) — der
// wertvollste Unit-Test-Kandidat. Ein stiller Regress hier würde Rollen still
// über- oder unterberechtigen.
describe("effectiveWriteScopes / canWrite", () => {
  it("S-Rollen (S1–S6) dürfen in alle Module schreiben", () => {
    for (const s of ["S1", "S2", "S3", "S4", "S5", "S6"] as Role[]) {
      const scopes = effectiveWriteScopes([s], CHAT_ON);
      expect([...scopes].sort()).toEqual([...MODULES].sort());
    }
  });

  it("LAGEKARTE darf Lagekarte + Kräfteübersicht + Chat (#100)", () => {
    const scopes = effectiveWriteScopes(["LAGEKARTE"], CHAT_ON);
    expect([...scopes].sort()).toEqual(["chat", "kraefteubersicht", "lagekarte"]);
    expect(canWrite(["LAGEKARTE"], "etb", CHAT_ON)).toBe(false);
    expect(canWrite(["LAGEKARTE"], "arbeitsblatt", CHAT_ON)).toBe(false);
    expect(canWrite(["LAGEKARTE"], "kraefteubersicht", CHAT_ON)).toBe(true);
  });

  it("ETB darf Einsatztagebuch + Kräfteübersicht + Chat (#100)", () => {
    const scopes = effectiveWriteScopes(["ETB"], CHAT_ON);
    expect([...scopes].sort()).toEqual(["chat", "etb", "kraefteubersicht"]);
    expect(canWrite(["ETB"], "lagekarte", CHAT_ON)).toBe(false);
    expect(canWrite(["ETB"], "kraefteubersicht", CHAT_ON)).toBe(true);
  });

  it("mehrere Rollen vereinigen ihre Rechte additiv", () => {
    const scopes = effectiveWriteScopes(["LAGEKARTE", "ETB"], CHAT_ON);
    expect([...scopes].sort()).toEqual(["chat", "etb", "kraefteubersicht", "lagekarte"]);
  });

  it("eine dominante S-Rolle macht die Kombination voll schreibberechtigt", () => {
    expect(canWrite(["MONITOR", "S3"], "arbeitsblatt", CHAT_OFF)).toBe(true);
  });

  describe("Monitor-Chat (E1, raum-konfigurierbar)", () => {
    it("darf bei allowMonitorChat=true chatten, sonst nichts", () => {
      expect([...effectiveWriteScopes(["MONITOR"], CHAT_ON)]).toEqual(["chat"]);
      expect(canWrite(["MONITOR"], "chat", CHAT_ON)).toBe(true);
    });

    it("darf bei allowMonitorChat=false gar nichts schreiben", () => {
      expect(effectiveWriteScopes(["MONITOR"], CHAT_OFF).size).toBe(0);
      expect(canWrite(["MONITOR"], "chat", CHAT_OFF)).toBe(false);
    });

    it("betrifft nur MONITOR — eine LAGEKARTE-Rolle chattet unabhängig davon", () => {
      expect(canWrite(["LAGEKARTE"], "chat", CHAT_OFF)).toBe(true);
    });

    it("MONITOR darf auch bei erlaubtem Chat nie in Feature-Module schreiben", () => {
      for (const m of ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht"] as Module[]) {
        expect(canWrite(["MONITOR"], m, CHAT_ON)).toBe(false);
      }
    });
  });

  it("leere Rollenliste ⇒ keine Schreibrechte", () => {
    expect(effectiveWriteScopes([], CHAT_ON).size).toBe(0);
  });

  it("jede deklarierte Rolle hat einen Eintrag in der Matrix", () => {
    // Fängt eine neue Rolle ab, die in ROLES landet, aber in WRITE_SCOPES vergessen wird.
    for (const r of ROLES) {
      expect(() => effectiveWriteScopes([r], CHAT_ON)).not.toThrow();
    }
  });
});

describe("hasStabRole (Gate für destruktive Gesamt-Aktionen, z.B. Bundle-Import #71)", () => {
  it("ist wahr, sobald eine S-Rolle dabei ist", () => {
    expect(hasStabRole(["S3"])).toBe(true);
    expect(hasStabRole(["MONITOR", "S1"])).toBe(true);
  });

  it("ist falsch für reine Modul-/Anzeigerollen", () => {
    expect(hasStabRole(["LAGEKARTE"])).toBe(false);
    expect(hasStabRole(["ETB"])).toBe(false);
    expect(hasStabRole(["MONITOR"])).toBe(false);
    expect(hasStabRole(["LAGEKARTE", "ETB", "MONITOR"])).toBe(false);
  });

  it("ist falsch für die leere Rollenliste", () => {
    expect(hasStabRole([])).toBe(false);
  });
});
