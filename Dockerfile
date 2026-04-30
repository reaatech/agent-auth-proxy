# syntax=docker/dockerfile:1
# For production, pin to a specific digest: docker buildx imagetools inspect node:22-alpine
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @reaatech/agent-auth-proxy-server run build

FROM node:22-alpine AS runtime

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/

RUN pnpm install --prod --frozen-lockfile --filter @reaatech/agent-auth-proxy-server

COPY --from=builder /app/packages/server/dist ./packages/server/dist

USER nodejs

EXPOSE 3000

WORKDIR /app/packages/server

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "dist/bin.js"]
