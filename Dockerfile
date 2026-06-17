# ── Build stage: compile TypeScript → dist/ ──────────────────────────
FROM node:25.6.0-slim AS build

WORKDIR /app

# Install all deps (incl. dev) for the build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so only runtime deps are carried forward.
RUN npm prune --omit=dev

# ── Runtime stage: slim image with only what the server needs ────────
FROM node:25.6.0-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# proto/ is loaded at runtime from process.cwd()/proto.
COPY proto ./proto

# gRPC (agents) and SSE/dashboard.
EXPOSE 50051 8081

CMD ["node", "dist/server.js"]
