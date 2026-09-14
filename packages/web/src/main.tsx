import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Selbstheilung nach Redeploy (#201): Hält ein Client die alte index.html-Shell
// (offener Tab / gecachte Shell), zeigen die /assets/*-Chunks nach einem Deploy
// neue Content-Hash-Namen — der alte Chunk fehlt. Ein dynamisches import() (z. B.
// pdf.ts beim Export) läuft dann ins Leere. Vite meldet das über `vite:preloadError`
// — und zwar UNABHÄNGIG von unserem try/catch um die import()-Aufrufe, das die
// Rejection sonst schluckt. Einmaliges Neuladen holt die frische Shell (die per
// Cache-Control: no-cache immer revalidiert, s. Caddyfile.web) mit den aktuellen
// Chunk-Referenzen. Ein Session-Flag verhindert eine Reload-Schleife, falls ein
// Chunk dauerhaft fehlt (kaputter Deploy / Backend down) — dann bleibt es beim
// klaren Konsolen-Fehler statt endlosem Neuladen.
const CHUNK_RELOAD_FLAG = "lks.chunkReloaded";
function reloadOnceForStaleChunks(): void {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return; // schon einmal probiert
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, "1");
  } catch {
    // Ohne sessionStorage kein Loop-Schutz → dann lieber NICHT automatisch neu laden.
    return;
  }
  window.location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault(); // sonst wirft Vite den Preload-Fehler ungefangen weiter
  reloadOnceForStaleChunks();
});

// Gürtel & Hosenträger: falls künftig ein dynamisches import() NICHT in try/catch
// sitzt, fängt die ungefangene Rejection denselben Fall ab (enge Text-Prüfung, um
// unbeteiligte Rejections nicht anzufassen).
window.addEventListener("unhandledrejection", (event) => {
  const reason = String(event.reason?.message ?? event.reason ?? "");
  if (/dynamically imported module|Loading chunk|Importing a module script failed/i.test(reason)) {
    reloadOnceForStaleChunks();
  }
});

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
