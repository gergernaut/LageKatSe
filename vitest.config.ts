import { defineConfig } from "vitest/config";

// Unit-Tests für reine Logik (Rollen/Rechte, Coercion, Formatierung, PDF-Umbruch).
// Keine DOM-/Server-Abhängigkeit → Node-Umgebung genügt. Die handgeschriebenen
// .mjs-Smoke-Tests (packages/web/scripts) bleiben ergänzend und laufen separat.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
