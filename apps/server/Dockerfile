# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/server/Dockerfile -t codevibe-sign .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@codevibe/sign-server-app..." run build
RUN pnpm --filter @codevibe/sign-server-app deploy --prod --legacy /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV FILES_DIR=/data/files
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
