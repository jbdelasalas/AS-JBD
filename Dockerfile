# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /repo

# Copy workspace manifests first for better Docker layer caching
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install all workspace deps
RUN npm install --workspaces --include-workspace-root

# Copy sources
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared first (api depends on it), then api
RUN npm run build --workspace=@perpet/shared
RUN npm run build --workspace=@perpet/api

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Copy only what's needed to run
COPY --from=builder /repo/package.json /repo/package-lock.json* ./
COPY --from=builder /repo/apps/api/package.json ./apps/api/
COPY --from=builder /repo/packages/shared/package.json ./packages/shared/
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist

# Install only production deps
RUN npm install --workspaces --include-workspace-root --omit=dev

# Default Railway/Render listen port
EXPOSE 10000

# The app honours the PORT env var (Railway/Render inject this automatically)
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
