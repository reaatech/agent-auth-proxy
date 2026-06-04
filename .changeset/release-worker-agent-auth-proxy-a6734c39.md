---
"@reaatech/agent-auth-proxy-core": minor
"@reaatech/agent-auth-proxy-server": patch
---

- **@reaatech/agent-auth-proxy-core** (minor): Gains a new public API surface: the error class types (AppError, AuthError, ScopeError, UpstreamError, ValidationError) are now exported from core and re-exported by the sibling packages, giving downstream consumers a first-class, documented way to catch and handle proxy errors without depending on internal paths.
- **@reaatech/agent-auth-proxy-server** (patch): Ships the previously-missing package README on the npm registry page, which materially improves discoverability and onboarding for downstream consumers and closes issue #14; the package itself was effectively un-presented on npm without it.
