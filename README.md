# Agent Auth Proxy

Identity-aware reverse proxy for secure agent-to-service communication.

A stateful proxy layer that sits between AI agents and downstream APIs (Google, GitHub, etc.), managing OAuth2 tokens, API keys, and scope enforcement on behalf of users. Built with a zero-trust security model — every request is authenticated, authorized, and audited.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-green)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10.0.0-orange)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](tsconfig.json)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Overview](#api-overview)
- [Development](#development)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Core

- **OAuth2 Proxy** — Full authorization code flow with PKCE, automatic token refresh, and transparent credential injection into proxied requests
- **API Key Vault** — AES-256-GCM encrypted storage for service credentials with per-user encryption keys derived via scrypt (N=16384)
- **Scope Enforcement** — Fine-grained permission control per user-agent grant with escalation detection and risk-level ceilings
- **Agent Authentication** — JWT-based agent identity with short-lived tokens and API key exchange

### Security

- **Zero-Trust Model** — Every request authenticated, authorized, and audited; no implicit trust between components
- **Defense in Depth** — Multiple validation layers: authentication → authorization → scope validation → credential selection
- **Rate Limiting** — Per-IP, per-user, and per-agent rate limiting with configurable windows
- **Header Sanitization** — Security-sensitive response headers stripped from downstream API responses
- **Constant-Time Comparison** — Admin API key validation resists timing attacks

### Operations

- **Structured Audit Logging** — Comprehensive audit trail with SIEM forwarding support (JSON, structured pino logs)
- **Health & Readiness** — `/health` and `/ready` endpoints for orchestration probes
- **Prometheus Metrics** — Request duration, auth success/failure, token refreshes, rate limit hits, scope violations
- **Circuit Breaker** — Proxy-to-upstream circuit breaker with configurable failure thresholds

---

## Architecture

```
┌─────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│   AI Agent  │─────▶│   Agent Auth Proxy   │─────▶│  Downstream API │
│  (Client)   │      │   (Identity Layer)   │      │  (Google, etc)  │
└─────────────┘      └──────────────────────┘      └─────────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  PostgreSQL  │
                    └──────────────┘
```

**Request Pipeline:**
1. Authenticate agent (JWT validation)
2. Extract user context and requested scopes
3. Validate granted scopes (scope enforcement)
4. Retrieve and decrypt user credentials
5. Attach credentials to downstream request
6. Forward and stream response back to agent

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed component design, security model, scaling strategy, and monitoring setup.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js 22+ |
| **Framework** | Fastify 5 |
| **Language** | TypeScript 5.8+ (strict mode) |
| **Database** | PostgreSQL 15+ |
| **ORM** | Drizzle ORM |
| **Auth** | `@fastify/jwt`, PKCE OAuth2 |
| **Validation** | Zod |
| **Logging** | Pino (structured JSON) |
| **Metrics** | prom-client |
| **Package Manager** | pnpm 10+ (workspaces) |
| **Build orchestration** | Turborepo |
| **Build** | tsup |
| **Lint/format** | Biome |
| **Test** | Vitest, Supertest |
| **Versioning** | Changesets |
| **Container** | Docker, Docker Compose |
| **Orchestration** | Kubernetes (manifests provided) |

---

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **PostgreSQL** 15+ (or Docker for local development)
- **Docker & Docker Compose** (optional, for containerized setup)

---

## Quick Start

### Option 1: Docker Compose

```bash
# Clone the repository
git clone https://github.com/reaatech/agent-auth-proxy.git
cd agent-auth-proxy

# Configure environment
cp .env.example .env
# Edit .env with your secrets (see Configuration section)

# Start services
docker compose up -d

# Run database migrations
docker compose --profile setup run --rm migrate

# Verify
curl http://localhost:3000/health
```

### Option 2: Local Development

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and generate MASTER_KEY

# Start PostgreSQL (Docker convenience)
docker compose up -d db

# Run migrations
pnpm db:migrate

# Start development server with hot reload
pnpm dev
```

---

## Configuration

### Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `MASTER_KEY` | Base64-encoded 32-byte encryption key for credential vault |
| `AGENT_JWT_SECRET` | Secret key for signing agent JWTs (32+ chars recommended) |
| `ADMIN_API_KEY` | Pre-shared key for management API endpoints |

### OAuth Providers

| Variable | Required For |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google API proxy |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub API proxy |
| `OAUTH_REDIRECT_URI` | OAuth2 callback URL (e.g., `https://proxy.example.com`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `NODE_ENV` | `development` | Environment (`development`, `production`, `test`) |
| `AGENT_JWT_EXPIRY` | `3600` | Agent JWT lifetime in seconds |
| `RATE_LIMIT_GLOBAL_MAX` | `1000` | Max requests per IP per 15-minute window |
| `PROXY_STREAM_TIMEOUT_MS` | `60000` | Upstream response timeout (ms) |
| `PROXY_BODY_LIMIT_BYTES` | `10485760` | Max request body size (10 MB) |
| `AUDIT_RETENTION_DAYS` | `90` | Days to retain audit logs |
| `AUDIT_BATCH_SIZE` | `100` | Audit log batch size for DB writes |
| `AUDIT_FLUSH_INTERVAL_MS` | `5000` | Audit log flush interval (ms) |
| `SIEM_ENDPOINT` | — | SIEM forwarding URL |
| `SIEM_API_KEY` | — | SIEM authentication key |

### Generating Secrets

```bash
# Generate MASTER_KEY (base64-encoded 32-byte key)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate ADMIN_API_KEY (base64url-encoded 32-byte key)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# Generate AGENT_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API Overview

### Agent Authentication

```
POST /auth/agent
Authorization: Bearer <agent_api_key>

Response: { "token": "<jwt>", "agent": { "id": "<uuid>", "name": "<string>" } }
```

Agents exchange their long-lived API key (prefix `aap_`) for a short-lived JWT (default 1 hour). The JWT is then used as a Bearer token for all proxied requests. Agent API keys are returned by `POST /api/v1/agents` at registration time — they are shown only once.

### Proxy Requests

Proxied requests forward method, path, headers, and body to the target downstream API with the user's credentials attached.

```
METHOD /proxy/:provider/<path...>
Authorization: Bearer <agent_jwt>
X-User-ID: <user_id>
?_scope=<comma,separated,scopes>      # Optional: enforce scopes

# Example: Read Google Calendar
curl -X GET "http://localhost:3000/proxy/google/calendar/v3/calendars/primary?_scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly" \
  -H "Authorization: Bearer <agent_jwt>" \
  -H "X-User-ID: <user_id>"
```

The proxy forwards status codes, headers, and body directly from the downstream API. No response envelope — compatible with standard HTTP clients and SDKs.

**Supported providers:** `google`, `github`

### Management API

All management endpoints are mounted under `/api/v1` and require the admin API key passed via the `X-Admin-API-Key` header.

**Users:**
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/users` | Create a user |
| `GET` | `/api/v1/users/:id` | Get user details |
| `DELETE` | `/api/v1/users/:id` | Delete a user |
| `GET` | `/api/v1/users/:id/grants` | List user's agent grants |

**Agents:**
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/agents` | Register a new agent (response includes the one-time `api_key`) |
| `GET` | `/api/v1/agents/:id` | Get agent details |
| `DELETE` | `/api/v1/agents/:id` | Delete an agent |

**Grants:**
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/grants` | Create user-agent grant with scopes |
| `GET` | `/api/v1/grants` | List all grants |
| `DELETE` | `/api/v1/grants/:id` | Revoke a grant |

**Tokens:**
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tokens` | List OAuth token metadata (no secrets) |
| `DELETE` | `/api/v1/tokens/:id` | Revoke a token |

**OAuth:**
| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth/authorize?user_id&provider&scopes` | Initiate OAuth2 authorization flow (redirects to provider) |
| `GET` | `/oauth/:provider/callback` | OAuth2 callback (handled by provider redirect) |

### Client SDK

A typed TypeScript SDK is published as `@reaatech/agent-auth-proxy-client`. It wraps these endpoints with `AgentClient` (auth + proxy) and `AdminClient` (management). See [`packages/client/README.md`](packages/client/README.md).

---

## Development

```bash
# Install dependencies
pnpm install

# Start development server (hot reload)
pnpm dev

# Build for production
pnpm build

# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm test:watch

# Run security-focused tests
pnpm test:security

# Type-check the project
pnpm typecheck

# Lint and format
pnpm lint
pnpm format

# Database operations
pnpm db:generate          # Generate migration files from schema
pnpm db:migrate           # Run pending migrations
pnpm db:seed              # Seed database with test data
pnpm db:studio            # Open Drizzle Studio (GUI)

# Security audit
pnpm audit
```

### Code Quality

CI enforces:
- Biome lint + format (`pnpm lint`, `pnpm format:check`)
- TypeScript strict mode (`pnpm typecheck`)
- Test coverage thresholds (85% lines, 85% functions, 78% branches)
- `pnpm audit` at moderate level and above

---

## Deployment

### Docker

```bash
# Build the image
pnpm docker:build

# Run with Docker Compose
pnpm docker:up

# Tear down
pnpm docker:down
```

The Dockerfile uses multi-stage builds: a `builder` stage compiles TypeScript, and a slim `runtime` stage runs the application as a non-root `nodejs` user.

### Kubernetes

Kubernetes manifests are provided in `k8s/`:

| Manifest | Purpose |
|---|---|
| `deployment.yaml` | 3-replica deployment with resource limits and health probes |
| `service.yaml` | ClusterIP service on port 3000 |
| `ingress.yaml` | Ingress configuration for external access |
| `hpa.yaml` | HorizontalPodAutoscaler (3–20 replicas, CPU 70% / memory 80%) |
| `secrets.yaml` | Secret template for `DATABASE_URL`, `MASTER_KEY`, etc. |

```bash
kubectl apply -f k8s/
```

### Production Considerations

- Front the service with a reverse proxy (nginx, AWS ALB) for TLS termination
- Store secrets in a secrets manager (AWS Secrets Manager, HashiCorp Vault, Kubernetes Secrets)
- Set `NODE_ENV=production`
- Enable audit log SIEM forwarding for centralized monitoring
- Rotate `MASTER_KEY`, `AGENT_JWT_SECRET`, and `ADMIN_API_KEY` regularly

---

## Project Structure

This is a pnpm + Turborepo monorepo with three publishable packages.

```
agent-auth-proxy/
├── packages/
│   ├── core/                          # @reaatech/agent-auth-proxy-core
│   │   └── src/                       # zod schemas, OAuth/scope types, error classes
│   ├── client/                        # @reaatech/agent-auth-proxy-client
│   │   └── src/                       # AgentClient + AdminClient SDKs (fetch-based)
│   └── server/                        # @reaatech/agent-auth-proxy-server
│       ├── src/
│       │   ├── api/                   # Fastify routes and middleware
│       │   ├── auth/                  # OAuth2 manager, key vault, scope enforcer
│       │   ├── config/                # Environment and app configuration
│       │   ├── db/
│       │   │   ├── schema/            # Drizzle ORM table definitions
│       │   │   └── migrations/        # SQL migration files
│       │   ├── proxy/                 # Proxy engine
│       │   ├── services/              # Audit logging, cleanup tasks
│       │   ├── utils/                 # Crypto, logger
│       │   ├── app.ts                 # buildApp() / start() — library entry
│       │   └── bin.ts                 # CLI entry (#!/usr/bin/env node)
│       ├── tests/                     # Vitest suites (unit + integration + security)
│       ├── scripts/                   # migrate.ts, seed.ts
│       ├── drizzle.config.ts
│       └── vitest.config.ts
├── docs/                              # Extended documentation
├── skills/                            # AI agent development skill definitions
├── k8s/                               # Kubernetes manifests
├── docker/                            # Docker assets
├── .github/workflows/                 # CI/CD pipeline definitions
├── .changeset/                        # Changesets for versioning + publishing
├── Dockerfile                         # Builds and runs packages/server
├── docker-compose.yml                 # Local development stack
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.json                      # Shared base config
└── package.json                       # Workspace root (private)
```

### Package responsibilities

| Package | Purpose | Depends on |
|---|---|---|
| `@reaatech/agent-auth-proxy-core` | Shared zod schemas, OAuth/scope types, error classes. No framework deps. | `zod` |
| `@reaatech/agent-auth-proxy-client` | Typed HTTP SDK (`AgentClient`, `AdminClient`) for talking to the proxy. | `core` |
| `@reaatech/agent-auth-proxy-server` | Fastify-based proxy server. Embeddable via `buildApp()`/`start()`, runnable via the `agent-auth-proxy-server` bin. | `core` |

---

## Security

- **Credential Encryption:** OAuth tokens and API keys are encrypted at rest with AES-256-GCM, with per-user encryption keys derived via scrypt (N=16384) from the `MASTER_KEY`
- **Agent Auth:** Short-lived JWTs (default 1 hour) with unique token IDs for revocation
- **Admin API:** Protected by a pre-shared key validated with constant-time comparison
- **No Credential Exposure:** Decrypted credentials are never returned to agents — they are attached by the proxy internally
- **Header Stripping:** Downstream security headers (`set-cookie`, `x-powered-by`, etc.) are removed from proxy responses

For reporting vulnerabilities, see [SECURITY.md](SECURITY.md). Do not open public issues for security concerns.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Development setup
- Code style (Biome, Conventional Commits)
- Testing requirements
- Pull request process (Changesets for versioning)
- Security best practices

---

## License

MIT © 2026 Rick Somers. See [LICENSE](LICENSE) for full terms.
