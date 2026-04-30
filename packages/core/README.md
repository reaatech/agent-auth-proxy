# @reaatech/agent-auth-proxy-core

Shared types, zod schemas, and error classes used by the agent-auth-proxy server and client SDK.

This package is framework-agnostic — it has no dependencies on Fastify, Drizzle, or any HTTP client. It only depends on `zod` for runtime schema validation.

## Install

```bash
pnpm add @reaatech/agent-auth-proxy-core
```

## What's exported

- **Errors** — `AppError`, `AuthError`, `ScopeError`, `ValidationError`, `UpstreamError`
- **Request schemas** — `proxyParamsSchema`, `proxyRequestSchema`, `oauthInitiateSchema`
- **OAuth types** — `OAuthProviderConfig`, `OAuth2IntegrationInputs`, `OAuth2TokenResponse`, `OAuth2UserInfo`
- **Scope types** — `ScopeValidationResult`

## License

MIT
