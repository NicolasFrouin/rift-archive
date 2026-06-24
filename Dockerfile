# syntax=docker/dockerfile:1

# ---- base: node + pnpm via corepack ----
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps: install all deps (cached on lockfile) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- runtime: source + deps, run via tsx (no build step needed) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Default command runs the always-on worker; the CLI is invoked with
#   docker compose run --rm worker pnpm cli <command>
CMD ["pnpm", "worker"]
