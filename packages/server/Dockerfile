FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/server/package.json packages/server/package.json
RUN pnpm install --filter @ank1015-app/server... --frozen-lockfile

COPY packages/server packages/server
RUN pnpm --filter @ank1015-app/server build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && npm install -g @openai/codex@0.128.0 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server ./packages/server

EXPOSE 4000
CMD ["node", "packages/server/dist/index.js"]
