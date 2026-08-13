# LageKatSe web image (multi-stage: build the SPA, then serve dist/ via Caddy).
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile --filter @lagekatse/web --filter @lagekatse/shared

COPY packages/shared/src packages/shared/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/web/src packages/web/src
COPY packages/web/public packages/web/public
COPY packages/web/tsconfig.json packages/web/tsconfig.json
COPY packages/web/vite.config.ts packages/web/vite.config.ts
COPY packages/web/index.html packages/web/index.html
COPY tsconfig.base.json ./

# Build the SPA. VITE_API_URL defaults to "" (same-origin behind proxy).
RUN pnpm --filter @lagekatse/web build

# --- Runtime: static files via Caddy ---
FROM caddy:2-alpine

COPY --from=build /app/packages/web/dist /srv
COPY packages/web/Caddyfile.web /etc/caddy/Caddyfile