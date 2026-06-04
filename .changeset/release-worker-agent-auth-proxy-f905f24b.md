---
"@reaatech/agent-auth-proxy-client": patch
---

- **@reaatech/agent-auth-proxy-client** (patch): Re-exports the error classes (AppError, AuthError, ScopeError, UpstreamError, ValidationError) from @reaatech/agent-auth-proxy-core, expanding the client's public API surface and enabling downstream consumers to perform instanceof checks on thrown errors.
