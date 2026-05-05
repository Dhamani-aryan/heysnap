FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/cloud-server/package.json packages/cloud-server/package.json
RUN pnpm install --filter @ank1015-app/cloud-server... --frozen-lockfile

COPY packages/cloud-server packages/cloud-server
RUN pnpm --filter @ank1015-app/cloud-server build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/cloud-server ./packages/cloud-server

EXPOSE 4100
CMD ["node", "packages/cloud-server/dist/index.js"]
