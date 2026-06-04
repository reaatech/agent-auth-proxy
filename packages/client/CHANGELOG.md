# @reaatech/agent-auth-proxy-client

## 2.0.0

### Major Changes

- [#9](https://github.com/reaatech/agent-auth-proxy/pull/9) [`53ad1e3`](https://github.com/reaatech/agent-auth-proxy/commit/53ad1e30373c4f2f42662c15962d2c28bf01756c) Thanks [@reaatech](https://github.com/reaatech)! - Initial public release. Splits the agent-auth-proxy into three publishable packages:

  - `@reaatech/agent-auth-proxy-core` — shared zod schemas, OAuth/scope types, and error classes.
  - `@reaatech/agent-auth-proxy-client` — typed `AgentClient` and `AdminClient` SDKs (fetch-based, framework-free) for talking to the proxy server.
  - `@reaatech/agent-auth-proxy-server` — Fastify-based proxy server, embeddable via `buildApp()`/`start()` or runnable via the `agent-auth-proxy-server` bin.

### Patch Changes

- [`40462ce`](https://github.com/reaatech/agent-auth-proxy/commit/40462cee685ec90d394d0857a39b129f5e2f85a1) Thanks [@reaatech](https://github.com/reaatech)! - - **@reaatech/agent-auth-proxy-client** (patch): Re-exports the error classes (AppError, AuthError, ScopeError, UpstreamError, ValidationError) from @reaatech/agent-auth-proxy-core, expanding the client's public API surface and enabling downstream consumers to perform instanceof checks on thrown errors.

- Updated dependencies [[`53ad1e3`](https://github.com/reaatech/agent-auth-proxy/commit/53ad1e30373c4f2f42662c15962d2c28bf01756c), [`f905f24`](https://github.com/reaatech/agent-auth-proxy/commit/f905f24b951f0fe946c4acc4643eb471acb6eecb)]:
  - @reaatech/agent-auth-proxy-core@2.0.0
