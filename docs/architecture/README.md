# Architecture Documentation

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full system architecture.

## Components

- **API Layer** (`src/api/`): Fastify routes, middleware, validation
- **Auth Layer** (`src/auth/`): OAuth2 manager, key vault, scope enforcer
- **Proxy Layer** (`src/proxy/`): Request forwarding, credential injection
- **DB Layer** (`src/db/`): Drizzle ORM schemas and migrations
- **Services** (`src/services/`): Audit logging
