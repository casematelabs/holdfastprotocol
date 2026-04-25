# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# python3 + make + g++ required by better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Persistent volume mount point for SQLite database
RUN mkdir -p /data

ENV DB_PATH=/data/reputation.db
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3001/health 2>/dev/null || exit 1

CMD ["node", "dist/index.js"]
