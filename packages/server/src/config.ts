export interface Config {
  port: number;
  jwtSecret: string;
  databaseUrl: string | null;
  corsOrigin: string;
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT ?? 8080);
  const jwtSecret = process.env.JWT_SECRET ?? "dev-only-change-me";
  const rawDb = process.env.DATABASE_URL?.trim();
  const databaseUrl = rawDb ? rawDb : null;
  const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

  if (jwtSecret === "dev-only-change-me") {
    console.warn("[config] Using the default JWT secret — set JWT_SECRET before any real deployment.");
  }
  return { port, jwtSecret, databaseUrl, corsOrigin };
}
