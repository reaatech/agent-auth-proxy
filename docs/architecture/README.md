# Architecture Documentation

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full system architecture.

## Packages

This is a pnpm + Turborepo monorepo. The runtime is split across three publishable packages:

- **`@reaatech/agent-auth-proxy-core`** (`packages/core/`) — shared zod schemas (`proxyParamsSchema`, `proxyRequestSchema`, `oauthInitiateSchema`), OAuth/scope types (`OAuth2TokenResponse`, `ScopeValidationResult`, etc.), and error classes (`AppError`, `AuthError`, `ScopeError`, `ValidationError`, `UpstreamError`). No framework dependencies.
- **`@reaatech/agent-auth-proxy-client`** (`packages/client/`) — typed HTTP SDK (`AgentClient`, `AdminClient`). Depends only on `core`. Server error responses are decoded into the matching `core` error class (401 → `AuthError`, 403 → `ScopeError`, etc.).
- **`@reaatech/agent-auth-proxy-server`** (`packages/server/`) — the Fastify-based proxy server. Depends on `core`. Embeddable via `buildApp()` / `start()` exports, runnable via the `agent-auth-proxy-server` bin.

## Server components

All paths below are relative to `packages/server/src/`.

- **API Layer** (`api/`): Fastify routes, middleware, validation
- **Auth Layer** (`auth/`): OAuth2 manager, key vault, scope enforcer
- **Proxy Layer** (`proxy/`): Request forwarding, credential injection
- **DB Layer** (`db/`): Drizzle ORM schemas and migrations
- **Services** (`services/`): Audit logging, cleanup tasks
- **Utilities** (`utils/`): Crypto, logger
- **Entry points**: `app.ts` (library — `buildApp()`/`start()`), `bin.ts` (CLI)
