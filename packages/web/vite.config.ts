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
  },
});
