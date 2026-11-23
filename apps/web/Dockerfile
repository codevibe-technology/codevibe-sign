# syntax=docker/dockerfile:1.7
# The web app (app, HTTP API and docs at /docs) as one image.
# Build from the repository root: docker build -f apps/web/Dockerfile -t codevibe-sign-web .

ARG NODE_IMAGE=node:22.23.5-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline
# Packages first, then the docs (copied into apps/web/docs-dist), the app and the operator scripts.
RUN pnpm build
RUN pnpm --filter web build:docs
RUN NEXT_OUTPUT=standalone pnpm --filter web build
RUN pnpm --filter web build:ops

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV FILES_DIR=/data/files
ENV DOCS_DIR=/app/apps/web/docs-dist
RUN groupadd --system --gid 1001 sign \
  && useradd --system --uid 1001 --gid sign --home-dir /app --shell /usr/sbin/nologin sign \
  && mkdir -p /data/files \
  && chown -R sign:sign /data
WORKDIR /app
COPY --from=build --chown=sign:sign /repo/apps/web/.next/standalone ./
COPY --from=build --chown=sign:sign /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=sign:sign /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=sign:sign /repo/apps/web/docs-dist ./apps/web/docs-dist
COPY --from=build --chown=sign:sign /repo/apps/web/ops ./apps/web/ops
WORKDIR /app/apps/web
USER sign
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
