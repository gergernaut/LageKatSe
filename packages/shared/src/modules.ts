/**
 * The collaborative sub-applications of a Stabsraum. Each module is an
 * independent Yjs document *and* an independent permission scope — the
 * document boundary is the rights boundary (see architecture.md §5.1).
 */
export const MODULES = ["lagekarte", "etb", "arbeitsblatt", "chat"] as const;

export type Module = (typeof MODULES)[number];

export function isModule(value: unknown): value is Module {
  return typeof value === "string" && (MODULES as readonly string[]).includes(value);
}

export const MODULE_LABELS: Record<Module, string> = {
  lagekarte: "Gemeinsame Lagekarte",
  etb: "Einsatztagebuch",
  arbeitsblatt: "Taktisches Arbeitsblatt",
  chat: "Stabsraum-Chat",
};
