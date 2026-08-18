import type { Module } from "./modules";

/**
 * Stabsrollen. A user may hold several at once; effective rights are the
 * union of the per-role rights (architecture.md §6.2).
 */
export const ROLES = [
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "LDS",
  "ETB",
  "LAGEKARTE",
  "MONITOR",
  "BR_LEITER",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Die Stabsfunktionen (S1–S6) plus LdS/Einsatzleiter (LDS). Eine Stabsrolle steht
 * für die eigentliche Führungsverantwortung — im Gegensatz zu den reinen Modul-/
 * Anzeigerollen (LAGEKARTE/ETB/BR_LEITER/MONITOR). Wird für destruktive
 * Gesamt-Aktionen genutzt, die strenger als eine einzelne Modul-Schreibberechtigung
 * gated sein sollen.
 */
export const STAB_ROLES: Role[] = ["S1", "S2", "S3", "S4", "S5", "S6", "LDS"];

/** Hält die Rollenkombination mindestens eine Stabsrolle (S1–S6 oder LdS)? */
export function hasStabRole(roles: readonly Role[]): boolean {
  return roles.some((r) => (STAB_ROLES as readonly Role[]).includes(r));
}

export const ROLE_LABELS: Record<Role, string> = {
  S1: "S1 · Personal / Innerer Dienst",
  S2: "S2 · Lage",
  S3: "S3 · Einsatz",
  S4: "S4 · Versorgung / Logistik",
  S5: "S5 · Presse- und Medienarbeit",
  S6: "S6 · Information und Kommunikation",
  LDS: "LdS / Einsatzleiter",
  LAGEKARTE: "Lagekartenführer",
  ETB: "Einsatztagebuchführer",
  MONITOR: "Monitor",
  BR_LEITER: "Leiter BR",
};

/**
 * Which modules each role may WRITE. Reading is allowed for every role in
 * every module (the whole Lage is visible to the whole staff), so only the
 * write scope is modelled here.
 */
export const WRITE_SCOPES: Record<Role, Module[]> = {
  S1: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  S2: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  S3: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  S4: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  S5: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  S6: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  // LdS / Einsatzleiter — volle Schreibrechte wie Stabsrollen (#102).
  LDS: ["lagekarte", "etb", "arbeitsblatt", "kraefteubersicht", "chat"],
  // Lagekarten- und ETB-Führer dürfen die Kräfteübersicht mitpflegen (#100).
  LAGEKARTE: ["lagekarte", "kraefteubersicht", "chat"],
  ETB: ["etb", "kraefteubersicht", "chat"],
  MONITOR: [],
  // Leiter BR — nur Kräfteübersicht, Rest read-only (#102).
  BR_LEITER: ["kraefteubersicht", "chat"],
};

/**
 * Context that can flip a room-configurable permission. Currently only the
 * "may the Monitor role write to chat?" decision (E1) — default on.
 */
export interface PermissionContext {
  allowMonitorChat: boolean;
}

/**
 * Effective set of modules the given role combination may write to, merged
 * additively (the most permissive role wins).
 */
export function effectiveWriteScopes(
  roles: readonly Role[],
  ctx: PermissionContext,
): Set<Module> {
  const scopes = new Set<Module>();
  for (const role of roles) {
    for (const module of WRITE_SCOPES[role]) scopes.add(module);
  }
  // Room-configurable: a pure Monitor may still chat unless the room disables it.
  if (ctx.allowMonitorChat && roles.includes("MONITOR")) {
    scopes.add("chat");
  }
  return scopes;
}

/** Authoritative check used by the WebSocket gateway before applying a write. */
export function canWrite(
  roles: readonly Role[],
  module: Module,
  ctx: PermissionContext,
): boolean {
  return effectiveWriteScopes(roles, ctx).has(module);
}
