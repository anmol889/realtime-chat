# syntax=docker/dockerfile:1.7
# Build context is the repository root (pnpm workspace). Multi-stage: install -> build -> slim runtime.
ARG SERVICE=user-service

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS deps
ARG SERVICE
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/${SERVICE}/package.json apps/${SERVICE}/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter ${SERVICE}

FROM deps AS build
ARG SERVICE
COPY apps/${SERVICE} apps/${SERVICE}
RUN pnpm --filter ${SERVICE} prisma:generate && pnpm --filter ${SERVICE} build
# `pnpm deploy` produces a self-contained folder with only production deps for this one package.
RUN pnpm --filter ${SERVICE} deploy --prod /out && cd /out && ./node_modules/.bin/prisma generate

FROM node:20-alpine AS runtime
ARG SERVICE
ENV NODE_ENV=production
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
