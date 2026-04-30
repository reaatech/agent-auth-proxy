---
'@reaatech/agent-auth-proxy-core': major
'@reaatech/agent-auth-proxy-client': major
'@reaatech/agent-auth-proxy-server': major
---

Initial public release. Splits the agent-auth-proxy into three publishable packages:

- `@reaatech/agent-auth-proxy-core` — shared zod schemas, OAuth/scope types, and error classes.
- `@reaatech/agent-auth-proxy-client` — typed `AgentClient` and `AdminClient` SDKs (fetch-based, framework-free) for talking to the proxy server.
- `@reaatech/agent-auth-proxy-server` — Fastify-based proxy server, embeddable via `buildApp()`/`start()` or runnable via the `agent-auth-proxy-server` bin.
