# @reaatech/agent-auth-proxy-server

Identity-aware proxy server for agent-to-service communication. Ships as a Fastify plugin (exporting `buildApp` and `start` from `app.ts`) and a CLI binary (`agent-auth-proxy-server`).

Handles API key authentication, OAuth2 authorization code flow with PKCE, JWT issuance, scope enforcement, proxied credential injection, and audit logging. Pairs with `@reaatech/agent-auth-proxy-core` for shared schemas and `@reaatech/agent-auth-proxy-client` for the typed HTTP SDK.

## Install

```bash
pnpm add @reaatech/agent-auth-proxy-server
```

## Quick start

```ts
import { buildApp, start } from '@reaatech/agent-auth-proxy-server';

// Build the app without starting it (useful for testing)
const app = await buildApp();
await app.ready();

// Or start the full server with signal handling
await start();
```

Or from the CLI:

```bash
npx agent-auth-proxy-server
```

Requires a PostgreSQL database and configuration via environment variables (see `.env.example`).

## What's exported

- **`buildApp()`** — Creates and configures a Fastify instance with all routes, plugins, and error handling registered. Returns the app without listening.
- **`start()`** — Calls `buildApp()`, registers signal handlers, starts listening, and begins background cleanup timers. Returns the listening app.

## Capabilities

| Route                | Description                                      |
| -------------------- | ------------------------------------------------ |
| `GET /health`        | Health check                                     |
| `POST /auth/init`    | OAuth2 initiate (authorization URL + PKCE)       |
| `POST /auth/callback`| OAuth2 callback (code exchange, token storage)    |
| `POST /proxy`        | Proxy a request with injected credentials        |
| `POST /api/v1/...`   | Admin management (users, agents, grants, tokens) |

## License

MIT
