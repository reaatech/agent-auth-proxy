# Skill: Database Schema Design

## Overview

Designs and implements the PostgreSQL database schema for the agent-auth-proxy system, including tables for users, agents, OAuth tokens, API keys, grants, and audit logging with proper indexing and relationships.

## Metadata

- **Name**: Database Schema Design
- **Description**: Creates comprehensive PostgreSQL schema with tables, indexes, relationships, and migrations for credential management
- **Complexity**: Medium
- **Estimated Time**: 2 hours
- **Dependencies**: Project Scaffolding

## Inputs

```typescript
interface DatabaseSchemaInputs {
  databaseUrl: string;           // PostgreSQL connection string
  schemaName?: string;           // Default: 'public'
  enableEncryption?: boolean;    // Default: true
  enableAudit?: boolean;         // Default: true
  enableRowLevelSecurity?: boolean; // Default: true
  multiTenant?: boolean;         // Default: false
}
```

## Outputs

### Core Tables

#### 1. Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);
```

#### 2. Agents Table
```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  api_key_hash VARCHAR(255) NOT NULL,
  api_key_prefix VARCHAR(8) NOT NULL, -- For identification without exposing full key
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT agents_name_unique UNIQUE (name)
);

CREATE INDEX idx_agents_api_key_prefix ON agents(api_key_prefix);
CREATE INDEX idx_agents_active ON agents(active);
```

#### 3. User-Agent Grants Table
```sql
CREATE TABLE user_agent_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL, -- Array of granted scopes
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason VARCHAR(255),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT user_agent_grants_user_agent_unique UNIQUE (user_id, agent_id),
  CONSTRAINT user_agent_grants_scopes_check CHECK (array_length(scopes, 1) > 0)
);

CREATE INDEX idx_user_agent_grants_user_id ON user_agent_grants(user_id);
CREATE INDEX idx_user_agent_grants_agent_id ON user_agent_grants(agent_id);
CREATE INDEX idx_user_agent_grants_expires_at ON user_agent_grants(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_user_agent_grants_active ON user_agent_grants(user_id, agent_id) WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
```

#### 4. OAuth Tokens Table (Encrypted)
```sql
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL, -- e.g., 'google', 'github', 'microsoft'
  access_token_encrypted TEXT NOT NULL,
  access_token_iv BYTEA NOT NULL, -- Initialization vector for AES-GCM
  refresh_token_encrypted TEXT,
  refresh_token_iv BYTEA,
  token_type VARCHAR(50) DEFAULT 'Bearer',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  scopes TEXT[] NOT NULL,
  id_token_encrypted TEXT, -- For OIDC
  id_token_iv BYTEA,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT oauth_tokens_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT oauth_tokens_expires_check CHECK (expires_at > created_at)
);

CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);
CREATE INDEX idx_oauth_tokens_user_provider ON oauth_tokens(user_id, provider) WHERE revoked_at IS NULL;
```

#### 5. API Keys Table (Encrypted)
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_iv BYTEA NOT NULL,
  key_hash VARCHAR(255) NOT NULL, -- For verification without decryption
  key_prefix VARCHAR(8) NOT NULL, -- For identification
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT api_keys_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_provider ON api_keys(provider);
CREATE INDEX idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider) WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());
```

#### 6. Service Accounts Table
```sql
CREATE TABLE service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  permissions TEXT[] NOT NULL, -- Array of permission strings
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT service_accounts_name_unique UNIQUE (name)
);

CREATE INDEX idx_service_accounts_active ON service_accounts(active);
CREATE INDEX idx_service_accounts_permissions ON service_accounts USING GIN(permissions);

-- OAuth PKCE states (temporary, Redis fallback)
CREATE TABLE oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state VARCHAR(255) UNIQUE NOT NULL,
  code_verifier TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_oauth_states_state ON oauth_states(state);
CREATE INDEX idx_oauth_states_expires_at ON oauth_states(expires_at);
```

#### 7. Service Account Tokens Table
```sql
CREATE TABLE service_account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id UUID NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL, -- Hash of JWT token
  token_prefix VARCHAR(8) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT service_account_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_service_account_tokens_service_account_id ON service_account_tokens(service_account_id);
CREATE INDEX idx_service_account_tokens_token_prefix ON service_account_tokens(token_prefix);
CREATE INDEX idx_service_account_tokens_expires_at ON service_account_tokens(expires_at);
CREATE INDEX idx_service_account_tokens_active ON service_account_tokens(service_account_id, expires_at) WHERE revoked_at IS NULL AND expires_at > NOW();
```

#### 8. Audit Logs Table
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  event_category VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),
  service_account_id UUID REFERENCES service_accounts(id),
  ip_address INET,
  user_agent TEXT,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(255),
  resource_id UUID,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  status_code INTEGER,
  details JSONB DEFAULT '{}'::jsonb,
  session_id UUID,
  trace_id UUID,
  span_id UUID,
  duration_ms INTEGER,
  CONSTRAINT audit_logs_event_type_check CHECK (event_type IN (
    'authentication', 'authorization', 'token_refresh', 'api_call',
    'scope_violation', 'configuration_change', 'security_event',
    'token_created', 'token_revoked', 'grant_created', 'grant_revoked'
  ))
);

-- Partitioning by month for performance (optional for large scale)
-- CREATE TABLE audit_logs_2024_01 PARTITION OF audit_logs
--   FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_logs_agent_id ON audit_logs(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_audit_logs_outcome ON audit_logs(outcome);
CREATE INDEX idx_audit_logs_ip_address ON audit_logs(ip_address) WHERE ip_address IS NOT NULL;
CREATE INDEX idx_audit_logs_timestamp_event_type ON audit_logs(timestamp, event_type);
CREATE INDEX idx_audit_logs_timestamp_user ON audit_logs(timestamp, user_id) WHERE user_id IS NOT NULL;
```

#### 9. Scopes Table (Reference Data)
```sql
CREATE TABLE scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL CHECK (category IN ('read', 'write', 'admin')),
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  requires_reconsent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT scopes_name_provider_unique UNIQUE (name, provider)
);

CREATE INDEX idx_scopes_provider ON scopes(provider);
CREATE INDEX idx_scopes_category ON scopes(category);
CREATE INDEX idx_scopes_risk_level ON scopes(risk_level);

-- Insert default scopes for common providers
INSERT INTO scopes (name, provider, description, category, risk_level) VALUES
  ('email', 'google', 'View your email address', 'read', 'low'),
  ('profile', 'google', 'View your basic info', 'read', 'low'),
  ('openid', 'google', 'Associate you with your Personal Info', 'read', 'low'),
  ('https://www.googleapis.com/auth/calendar.readonly', 'google', 'View your calendars', 'read', 'medium'),
  ('https://www.googleapis.com/auth/calendar.events', 'google', 'View and edit events on your calendars', 'write', 'high'),
  ('user:email', 'github', 'View your email address', 'read', 'low'),
  ('user:read', 'github', 'View your user data', 'read', 'low'),
  ('repo', 'github', 'Full control of private repositories', 'write', 'high');
```

#### 10. Rate Limits Table
```sql
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL, -- e.g., 'user:{user_id}', 'agent:{agent_id}', 'ip:{ip_address}'
  window_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  request_count INTEGER DEFAULT 1,
  window_duration_ms INTEGER NOT NULL, -- e.g., 900000 for 15 minutes
  max_requests INTEGER NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT rate_limits_key_window_unique UNIQUE (key, window_start)
);

CREATE INDEX idx_rate_limits_key ON rate_limits(key);
CREATE INDEX idx_rate_limits_window_start ON rate_limits(window_start);
CREATE INDEX idx_rate_limits_cleanup ON rate_limits(window_start) WHERE window_start < NOW() - INTERVAL '1 hour';

-- Function to clean up old rate limit records
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits 
  WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
```

#### 11. Tenants Table (Optional for Multi-Tenancy)
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) UNIQUE,
  active BOOLEAN DEFAULT TRUE,
  plan VARCHAR(50) DEFAULT 'free', -- free, pro, enterprise
  settings JSONB DEFAULT '{}'::jsonb,
  limits JSONB DEFAULT '{"users": 100, "agents": 10, "api_calls_per_day": 10000}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT tenants_name_unique UNIQUE (name)
);

-- Add tenant_id to users, agents tables if multi-tenant
ALTER TABLE users ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE agents ADD COLUMN tenant_id UUID REFERENCES tenants(id);

CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX idx_tenants_active ON tenants(active);
```

### Database Functions

#### Token Cleanup Function
```sql
CREATE OR REPLACE FUNCTION cleanup_expired_tokens() RETURNS void AS $$
BEGIN
  -- Clean up expired OAuth tokens
  UPDATE oauth_tokens 
  SET revoked_at = NOW() 
  WHERE expires_at < NOW() AND revoked_at IS NULL;
  
  -- Clean up expired API keys
  UPDATE api_keys 
  SET revoked_at = NOW() 
  WHERE expires_at < NOW() AND revoked_at IS NULL;
  
  -- Clean up expired service account tokens
  UPDATE service_account_tokens 
  SET revoked_at = NOW() 
  WHERE expires_at < NOW() AND revoked_at IS NULL;
  
  -- Clean up expired grants
  UPDATE user_agent_grants 
  SET revoked_at = NOW(), revoked_reason = 'expired'
  WHERE expires_at < NOW() AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql;
```

#### Audit Log Cleanup Function
```sql
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(retention_days INTEGER DEFAULT 90) RETURNS void AS $$
BEGIN
  DELETE FROM audit_logs 
  WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;
```

### Row Level Security (Optional)

```sql
-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_agent_grants ENABLE ROW LEVEL SECURITY;

-- Policy for users table (users can only see their own data)
CREATE POLICY users_isolation_policy ON users
  FOR ALL
  USING (id = current_setting('app.current_user_id', TRUE)::uuid);

-- Policy for oauth_tokens (users can only see their own tokens)
CREATE POLICY oauth_tokens_isolation_policy ON oauth_tokens
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', TRUE)::uuid);

-- Policy for api_keys (users can only see their own keys)
CREATE POLICY api_keys_isolation_policy ON api_keys
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', TRUE)::uuid);

-- Policy for user_agent_grants (users can only see their own grants)
CREATE POLICY user_agent_grants_isolation_policy ON user_agent_grants
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', TRUE)::uuid);
```

### Drizzle ORM Schema Files

#### src/db/schema/users.ts
```typescript
import { pgTable, uuid, varchar, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

#### src/db/schema/oauth_tokens.ts
```typescript
import { pgTable, uuid, varchar, text, timestamp, jsonb, bytea } from 'drizzle-orm/pg-core';
import { users } from './users';

export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 100 }).notNull(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  accessTokenIv: bytea('access_token_iv').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  refreshTokenIv: bytea('refresh_token_iv'),
  tokenType: varchar('token_type', { length: 50 }).default('Bearer'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes', { mode: 'array' }).notNull(),
  idTokenEncrypted: text('id_token_encrypted'),
  idTokenIv: bytea('id_token_iv'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
});

export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
```

#### src/db/schema/oauth_states.ts (PKCE fallback)
```typescript
import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const oauthStates = pgTable('oauth_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  state: varchar('state', { length: 255 }).notNull().unique(),
  codeVerifier: text('code_verifier').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type OauthState = typeof oauthStates.$inferSelect;
export type NewOauthState = typeof oauthStates.$inferInsert;
```

## Implementation Steps

1. **Set up PostgreSQL database**
   ```bash
   # Using Docker
   docker run -d \
     --name agent-auth-proxy-db \
     -e POSTGRES_PASSWORD=secure_password \
     -e POSTGRES_DB=agent_auth \
     -p 5432:5432 \
     postgres:15-alpine
   ```

2. **Configure Drizzle ORM**
   - Create drizzle.config.ts
   - Set up database connection
   - Define schema files

3. **Generate migrations**
   ```bash
   pnpm drizzle-kit generate
   ```

4. **Run migrations**
   ```bash
   pnpm db:migrate
   ```

5. **Create database seeders**
   - Seed default scopes
   - Create test users and agents
   - Add sample OAuth providers

6. **Set up database monitoring**
   - Configure pg_stat_statements extension
   - Set up slow query logging
   - Create monitoring queries

## Validation

After running this skill, verify:
- [ ] All tables created successfully
- [ ] Indexes are in place
- [ ] Foreign key relationships work
- [ ] Migrations run without errors
- [ ] Row level security policies (if enabled)
- [ ] Database functions execute correctly
- [ ] Drizzle ORM schema matches database

## Security Considerations

- All sensitive fields (tokens, keys) are encrypted at rest
- Row level security prevents cross-user data access
- Audit logging captures all security-relevant events
- Rate limiting tables prevent abuse
- Regular cleanup of expired data

## Performance Optimizations

- Indexes on frequently queried columns
- Composite indexes for common query patterns
- Partitioning for audit_logs (optional for scale)
- Connection pooling configuration
- Query optimization with EXPLAIN ANALYZE

## Next Steps

After database schema is complete:
1. OAuth2 integration implementation
2. API key vault encryption setup
3. Token management service development
