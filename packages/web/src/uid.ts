/**
 * A UUID-ish unique id that also works over plain HTTP on a LAN.
 *
 * `crypto.randomUUID()` is only exposed in a *secure context* (HTTPS or
 * localhost); over `http://<lan-ip>` it is undefined and calling it throws.
 * Fall back to `crypto.getRandomValues` (available in insecure contexts too),
 * then to a timestamp+random id as a last resort.
 */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
