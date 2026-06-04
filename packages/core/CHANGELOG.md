# @reaatech/agent-auth-proxy-core

## 2.0.0

### Major Changes

- [#9](https://github.com/reaatech/agent-auth-proxy/pull/9) [`53ad1e3`](https://github.com/reaatech/agent-auth-proxy/commit/53ad1e30373c4f2f42662c15962d2c28bf01756c) Thanks [@reaatech](https://github.com/reaatech)! - Initial public release. Splits the agent-auth-proxy into three publishable packages:

  - `@reaatech/agent-auth-proxy-core` — shared zod schemas, OAuth/scope types, and error classes.
  - `@reaatech/agent-auth-proxy-client` — typed `AgentClient` and `AdminClient` SDKs (fetch-based, framework-free) for talking to the proxy server.
  - `@reaatech/agent-auth-proxy-server` — Fastify-based proxy server, embeddable via `buildApp()`/`start()` or runnable via the `agent-auth-proxy-server` bin.

### Minor Changes

- [`f905f24`](https://github.com/reaatech/agent-auth-proxy/commit/f905f24b951f0fe946c4acc4643eb471acb6eecb) Thanks [@reaatech](https://github.com/reaatech)! - - **@reaatech/agent-auth-proxy-core** (minor): Gains a new public API surface: the error class types (AppError, AuthError, ScopeError, UpstreamError, ValidationError) are now exported from core and re-exported by the sibling packages, giving downstream consumers a first-class, documented way to catch and handle proxy errors without depending on internal paths.
  - **@reaatech/agent-auth-proxy-server** (patch): Ships the previously-missing package README on the npm registry page, which materially improves discoverability and onboarding for downstream consumers and closes issue [#14](https://github.com/reaatech/agent-auth-proxy/issues/14); the package itself was effectively un-presented on npm without it.
