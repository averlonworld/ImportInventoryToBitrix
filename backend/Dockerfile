# ==========================================
# Stage 1: Build
# Install dependencies + Generate Prisma Client + Compile TypeScript
# ==========================================
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy Prisma schema and migrations
COPY prisma ./prisma

# Install all dependencies (build needs the devDependencies: typescript, @types/*)
RUN npm ci

# Copy application source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile TypeScript -> dist/
RUN npm run build

# ==========================================
# Stage 2: Production Runtime
# ==========================================
FROM node:22-bookworm-slim

# tini for proper signal handling; openssl for the Bitrix24 crypto helpers;
# wget for the HEALTHCHECK below (not present in *-slim by default).
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini openssl wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user.
# NOTE: Debian's adduser/addgroup need the long-form --system flag; the short
# -S form is BusyBox-only (it works on alpine, not on bookworm).
RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup --no-create-home --shell /usr/sbin/nologin appuser

# ==========================================
# Install Production Dependencies
# ==========================================
COPY package*.json ./

# Copy Prisma schema and migrations (needed for `migrate deploy` at startup)
COPY prisma ./prisma

# `prisma` is a devDependency, but the startup command runs `prisma migrate
# deploy`, so the CLI has to exist in the runtime image. Install it explicitly
# rather than dragging in the whole devDependency tree.
RUN npm ci --omit=dev && \
    npm install --no-save prisma@^5.19.0 && \
    npm cache clean --force

# ==========================================
# Copy Compiled Application + Generated Prisma Client
# ==========================================
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist

# ==========================================
# Set Permissions
# ==========================================
RUN chown -R appuser:appgroup /app

USER appuser

# ==========================================
# Application Port
# ==========================================
EXPOSE 5000

# ==========================================
# Health Check
# ==========================================
HEALTHCHECK --interval=30s \
    --timeout=5s \
    --start-period=30s \
    --retries=3 \
    CMD wget --no-verbose \
    --tries=1 \
    --spider \
    http://localhost:5000/health || exit 1

# ==========================================
# Start Prisma Migration + Application
# ==========================================
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

