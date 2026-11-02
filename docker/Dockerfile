# Stillwater — self-host image. Builds packages/shared + apps/server and runs
# the server against Postgres (DATABASE_URL). Migrations run automatically
# before the server starts listening (see apps/server/src/index.ts).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --workspace apps/server --workspace packages/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace packages/shared
RUN npm run build --workspace apps/server

FROM node:22-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --workspace apps/server --workspace packages/shared --include-workspace-root --omit=dev

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /repo
RUN addgroup -S stillwater && adduser -S stillwater -G stillwater
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build /repo/apps/server/dist ./apps/server/dist
COPY --from=build /repo/apps/server/drizzle ./apps/server/drizzle
RUN mkdir -p /data/uploads && chown -R stillwater:stillwater /data /repo
USER stillwater
WORKDIR /repo/apps/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
