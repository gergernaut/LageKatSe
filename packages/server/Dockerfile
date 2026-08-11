# LageKatSe backend image.
# Uses tsx to run the TypeScript server directly (no separate build step —
# the project has noEmit and no tsc build script; tsx is the simplest path).
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace manifest + lockfile first (layer cache).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install server + shared deps (tsx is needed at runtime, so no --prod).
RUN pnpm install --frozen-lockfile --filter @lagekatse/server --filter @lagekatse/shared

# Copy source.
COPY packages/shared/src packages/shared/src
COPY packages/server/src packages/server/src
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/server/tsconfig.json packages/server/tsconfig.json
COPY tsconfig.base.json ./

EXPOSE 8080

CMD ["pnpm", "--filter", "@lagekatse/server", "start"]