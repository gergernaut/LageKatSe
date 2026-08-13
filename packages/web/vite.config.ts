import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Read env (including VITE_* vars) from the repo-root .env, so the whole
  // monorepo shares a single .env file alongside .env.example.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: {
    // host:true makes the dev server reachable from other machines (e.g. when
    // testing on a remote server), not just localhost.
    host: true,
    port: 5173,
    // Dev-Proxy: seit #65 ist VITE_API_URL per Default "" (same-origin hinter dem
    // Reverse-Proxy). Damit `pnpm dev` ohne .env funktioniert, proxyt der Dev-Server
    // dieselben Pfade ans lokale Backend wie Caddy in Produktion: /api (HTTP) und
    // /sync (WebSocket-Upgrade). Zielport überschreibbar via VITE_DEV_BACKEND.
    proxy: {
      "/api": { target: process.env.VITE_DEV_BACKEND ?? "http://localhost:8080", changeOrigin: true },
      "/sync": { target: process.env.VITE_DEV_BACKEND ?? "http://localhost:8080", ws: true, changeOrigin: true },
    },
  },
});
