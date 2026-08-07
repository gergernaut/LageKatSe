export interface Config {
  port: number;
  jwtSecret: string;
  databaseUrl: string | null;
  corsOrigin: string;
  /** Fastify hinter einem Reverse-Proxy? Dann X-Forwarded-For vertrauen (echte Client-IP fürs Rate-Limit). */
  trustProxy: boolean;
  rateLimit: {
    /** Fenstergröße in ms für alle Limits. */
    windowMs: number;
    /** Globales Limit pro IP & Fenster (Grundschutz für alle Endpunkte). */
    max: number;
    /** Strengeres Limit für sensible Endpunkte (Lobby-Join, Raum-Anlegen) — gegen Brute-Force/Enumeration. */
    sensitiveMax: number;
  };
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT ?? 8080);
  const jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-me";
  const rawDb = process.env.DATABASE_URL?.trim();
  const databaseUrl = rawDb ? rawDb : null;
  const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() ?? "");
  const rateLimit = {
    windowMs: intFromEnv("RATE_LIMIT_WINDOW_MS", 60_000),
    max: intFromEnv("RATE_LIMIT_MAX", 300),
    sensitiveMax: intFromEnv("RATE_LIMIT_SENSITIVE_MAX", 30),
  };

  if (jwtSecret === "dev-only-change-me") {
    console.warn("[config] Using the default JWT secret — set JWT_SECRET before any real deployment.");
  }
  return { port, jwtSecret, databaseUrl, corsOrigin, trustProxy, rateLimit };
}
