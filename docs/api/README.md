# API Documentation

See the main [README.md](../../README.md) for API usage examples.

## Authentication

- **Agent Auth**: `POST /auth/agent` with `Authorization: Bearer aap_...`
- **Admin Auth**: `X-Admin-API-Key` header for management endpoints
- **Proxy Auth**: `Authorization: Bearer <jwt>` + `X-User-ID` header

## Endpoints

### Health
- `GET /health` - Service health
- `GET /ready` - Readiness probe (includes DB check)
- `GET /metrics` - Prometheus metrics

### Auth
- `POST /auth/agent` - Exchange API key for JWT
- `GET /oauth/authorize` - Initiate OAuth flow
- `GET /oauth/:provider/callback` - OAuth callback

### Proxy
- `GET|POST|PUT|PATCH|DELETE /proxy/:provider/*` - Proxy to upstream API

### Management
- `POST /api/v1/users` - Create user
- `GET /api/v1/users/:id` - Get user
- `DELETE /api/v1/users/:id` - Delete user
- `POST /api/v1/agents` - Create agent
- `GET /api/v1/agents/:id` - Get agent
- `DELETE /api/v1/agents/:id` - Delete agent
- `POST /api/v1/grants` - Create grant
- `GET /api/v1/grants` - List grants
- `DELETE /api/v1/grants/:id` - Revoke grant
- `GET /api/v1/tokens` - List tokens
- `DELETE /api/v1/tokens/:id` - Revoke token
