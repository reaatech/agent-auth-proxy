<!-- From: /Users/rick/dev/2026-04/agent-auth-proxy/AGENTS.md -->
# Agent Skills: agent-auth-proxy

This document describes the AI agent skills available for developing the agent-auth-proxy project. Each skill represents a specialized capability that an AI agent can use to assist with specific aspects of the project.

## Available Skills

### 1. Project Scaffolding
**Location:** `skills/project-scaffold/skills.md`

Initializes the project structure with all necessary configuration files, dependencies, and directory organization.

### 2. Database Schema Design
**Location:** `skills/database-schema/skills.md`

Designs and implements the PostgreSQL database schema including tables, indexes, relationships, and migrations.

### 3. OAuth2 Integration
**Location:** `skills/oauth2-integration/skills.md`

Implements OAuth2 authorization code flow with PKCE, token management, and refresh token handling.

### 4. API Key Vault
**Location:** `skills/api-key-vault/skills.md`

Creates secure API key storage with AES-256-GCM encryption.

### 5. Proxy Engine
**Location:** `skills/proxy-engine/skills.md`

Builds the core proxy functionality including request interception, credential attachment, and response forwarding.

### 6. Scope Enforcement
**Location:** `skills/scope-enforcement/skills.md`

Implements scope validation, permission checking, and scope escalation prevention.

### 7. Audit Logging
**Location:** `skills/audit-logging/skills.md`

Creates comprehensive audit logging system with structured logs and SIEM integration.

### 8. Security Hardening
**Location:** `skills/security-hardening/skills.md`

Applies security best practices including encryption, rate limiting, and input validation.

### 9. Testing Suite
**Location:** `skills/testing-suite/skills.md`

Develops comprehensive test coverage including unit, integration, security, and performance tests.

### 10. DevOps & Deployment
**Location:** `skills/devops-deployment/skills.md`

Sets up CI/CD pipelines, Docker containerization, Kubernetes deployment, and monitoring.

## Using Agent Skills

Each skill is designed to be invoked independently or in combination with other skills. Skills can be executed in sequence to build the complete system.

### Skill Invocation Pattern

Skills are documentation-driven development guides. The agent:
1. Reads the skill's `skills.md`
2. Implements the code, tests, and configuration described
3. Marks skill complete and moves to dependent skills
4. State is implicit in the filesystem (code, migrations, configs)

### State Sharing
- Database schema lives in `packages/server/src/db/schema/`
- Server configuration is in `packages/server/src/config/` and environment variables
- Cross-package types, zod schemas, and error classes live in `packages/core/src/` (published as `@reaatech/agent-auth-proxy-core`)
- Server-internal services live in `packages/server/src/services/`
- The client SDK lives in `packages/client/src/` (published as `@reaatech/agent-auth-proxy-client`)

### Error Handling
- If a skill fails validation, the agent must fix it before proceeding
- Dependent skills must not be started until prerequisites pass validation
- Breaking changes to shared interfaces require updating all dependent skills

## Security Considerations

When executing skills:
- Never expose real credentials in logs
- Use mock data for testing
- Encrypt sensitive outputs
- Follow principle of least privilege
- Audit all skill executions

## GitHub Integration

This project uses GitHub user `reaatech` for:
- Source code repository
- Issue tracking
- CI/CD pipeline integration
- Package distribution

### Repository Structure

This is a pnpm + Turborepo monorepo. The deployable service lives in `packages/server`; the publishable SDK and shared types live in `packages/client` and `packages/core` respectively.

```
github.com/reaatech/agent-auth-proxy
├── packages/
│   ├── core/                # @reaatech/agent-auth-proxy-core (zod schemas, types, errors)
│   ├── client/              # @reaatech/agent-auth-proxy-client (typed HTTP SDK)
│   └── server/              # @reaatech/agent-auth-proxy-server (Fastify app)
│       ├── src/
│       ├── tests/
│       └── scripts/         # migrate.ts, seed.ts
├── skills/                  # Agent skill definitions
├── docs/
├── k8s/
├── .changeset/
├── Dockerfile               # Builds and runs packages/server
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── package.json             # Workspace root (private)
└── README.md
```
