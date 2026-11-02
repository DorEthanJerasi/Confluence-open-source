# Stillwater — self-host image. Builds apps/server and runs it against
# Postgres (DATABASE_URL). Migrations run automatically before the server
# starts listening (see apps/server/src/index.ts).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
RUN npm install --workspace apps/server --include-workspace-root
COPY apps/server apps/server
RUN npm run build --workspace apps/server

FROM node:22-alpine AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/package.json
RUN npm install --workspace apps/server --include-workspace-root --omit=dev

FROM node:22-alpine AS run
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S stillwater && adduser -S stillwater -G stillwater
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
RUN mkdir -p /data/uploads && chown -R stillwater:stillwater /data /app
USER stillwater
EXPOSE 3000
CMD ["node", "dist/index.js"]
