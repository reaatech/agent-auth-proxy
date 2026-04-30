# @reaatech/agent-auth-proxy-client

Typed HTTP client SDK for the [agent-auth-proxy](https://github.com/reaatech/agent-auth-proxy) server. Two clients ship in this package:

- **`AgentClient`** — for AI agents calling the proxy. Exchanges an API key for a JWT, then makes proxied requests.
- **`AdminClient`** — for admin tooling. Manages users, agents, grants, and tokens.

Server errors are decoded into the typed error classes from `@reaatech/agent-auth-proxy-core` (`AuthError`, `ScopeError`, `ValidationError`, `UpstreamError`, `AppError`).

## Install

```bash
pnpm add @reaatech/agent-auth-proxy-client
```

## Agent usage

```ts
import { AgentClient } from '@reaatech/agent-auth-proxy-client';

const client = new AgentClient({
  baseUrl: 'https://proxy.example.com',
  apiKey: 'aap_...',
});

await client.authenticate();

const response = await client.proxy({
  provider: 'google',
  path: 'calendar/v3/calendars/primary/events',
  userId: '00000000-0000-0000-0000-000000000001',
  method: 'GET',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

const events = await response.json();
```

## Admin usage

```ts
import { AdminClient } from '@reaatech/agent-auth-proxy-client';

const admin = new AdminClient({
  baseUrl: 'https://proxy.example.com',
  adminApiKey: process.env.ADMIN_API_KEY!,
});

const user = await admin.createUser({ email: 'alice@example.com' });
const agent = await admin.createAgent({ name: 'calendar-bot' });
await admin.createGrant({
  userId: user.id,
  agentId: agent.id,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});
```

## License

MIT
