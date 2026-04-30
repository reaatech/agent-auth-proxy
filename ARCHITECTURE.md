# Architecture: agent-auth-proxy

## System Overview

The agent-auth-proxy is a stateful, identity-aware reverse proxy that sits between AI agents and downstream APIs. It manages authentication credentials on behalf of users, ensuring proper isolation, scope enforcement, and audit compliance.

```
┌─────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│   AI Agent  │─────▶│   agent-auth-proxy   │─────▶│  Downstream API │
│  (Client)   │      │  (Identity Layer)    │      │  (Google, etc)  │
└─────────────┘      └──────────────────────┘      └─────────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │   Database   │
                    │  (PostgreSQL)│
                    └──────────────┘
```

## Core Architectural Principles

### 1. Zero-Trust Security Model
- Every request must be authenticated and authorized
- No implicit trust between components
- All credentials encrypted at rest and in transit
- Comprehensive audit logging for all operations

### 2. User-Centric Identity
- Users own their credentials
- Agents act on behalf of users with explicit grants
- Scopes are user-specific, not agent-specific
- Credential isolation is absolute

### 3. Defense in Depth
- Multiple layers of validation
- Encryption at multiple levels
- Rate limiting and DDoS protection
- Regular security audits and penetration testing

### 4. Performance at Scale
- Minimal proxy overhead (< 50ms)
- Efficient token caching
- Connection pooling and reuse
- Horizontal scalability

## System Components

### 1. API Gateway Layer

**Responsibilities:**
- Request routing and forwarding
- SSL/TLS termination
- Rate limiting and DDoS protection
- Request/response logging

**Technology:** Fastify 5.x with plugins

**Key Features:**
- High-performance HTTP handling
- Plugin architecture for extensibility
- Built-in validation and serialization
- WebSocket support for real-time features

### 2. Authentication Engine

**Components:**

#### 2.1 OAuth2 Manager
```typescript
interface OAuth2Manager {
  // Authorization code flow
  initiateAuthorization(userId: string, scopes: string[]): Promise<AuthUrl>;
  handleCallback(code: string, state: string): Promise<OAuthTokens>;
  
  // Token management
  refreshAccessToken(userId: string, provider: string): Promise<string>;
  revokeToken(userId: string, provider: string): Promise<void>;
  
  // Token storage
  storeTokens(userId: string, tokens: OAuthTokens): Promise<void>;
  getValidToken(userId: string, provider: string, scopes?: string[]): Promise<string>;
}
```

**Features:**
- PKCE support for public clients
- Automatic token refresh with retry logic
- Token encryption at rest
- Scope validation and enforcement

#### 2.2 API Key Vault
```typescript
interface ApiKeyVault {
  // Key management
  storeApiKey(userId: string, provider: string, key: string): Promise<void>;
  getApiKey(userId: string, provider: string): Promise<string>;
  rotateApiKey(userId: string, provider: string): Promise<string>;
  
  // Encryption
  encrypt(key: string): Promise<string>;
  decrypt(encryptedKey: string): Promise<string>;
}
```

**Features:**
- AES-256-GCM encryption
- Key encryption key (KEK) management
- Automatic key rotation
- Audit logging for key access

#### 2.3 Service Account Manager
```typescript
interface ServiceAccountManager {
  // Service account lifecycle
  createServiceAccount(name: string, permissions: string[]): Promise<ServiceAccount>;
  validateServiceAccount(token: string): Promise<ServiceAccountPayload>;
  revokeServiceAccount(id: string): Promise<void>;
  
  // Token management
  generateToken(serviceAccountId: string, ttl: number): Promise<string>;
  validateToken(token: string): Promise<boolean>;
}
```

**Features:**
- JWT-based authentication
- Short-lived tokens (default: 1 hour)
- Permission-based access control
- Automatic token rotation

### 3. Proxy Engine

**Request Processing Pipeline:**

```
1. Request Interception
   ├── SSL/TLS termination
   ├── Rate limiting check
   └── Request logging

2. User Context Extraction
   ├── Parse Authorization header
   ├── Validate JWT/API key
   └── Extract user ID and agent ID

3. Credential Selection
   ├── Query user's granted scopes
   ├── Check token validity
   ├── Select appropriate credential
   └── Handle token refresh if needed

4. Scope Validation
   ├── Verify requested scopes
   ├── Check user-agent permissions
   ├── Prevent scope escalation
   └── Log scope validation

5. Request Transformation
   ├── Attach credentials
   ├── Add proxy headers
   ├── Transform request body if needed
   └── Update content headers

6. Forward to Downstream
   ├── Execute request
   ├── Handle retries
   ├── Circuit breaker check
   └── Measure response time

7. Response Processing
   ├── Log response
   ├── Update audit trail
   ├── Handle token refresh on 401
   └── Return to client
```

**Technology:** Custom proxy middleware built on Fastify

### 4. Scope Enforcement Engine

**Scope Model:**

```typescript
interface Scope {
  id: string;
  name: string;
  description: string;
  provider: string; // e.g., 'google', 'github'
  category: 'read' | 'write' | 'admin';
  riskLevel: 'low' | 'medium' | 'high';
}

interface UserAgentGrant {
  userId: string;
  agentId: string;
  scopes: string[];
  grantedAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}
```

**Enforcement Logic:**

```typescript
class ScopeEnforcer {
  async validateRequest(
    userId: string,
    agentId: string,
    requestedScopes: string[],
    provider: string
  ): Promise<ValidationResult> {
    // 1. Get user-agent grants
    const grants = await this.getGrants(userId, agentId);
    
    // 2. Filter by provider
    const providerScopes = grants.filter(g => g.provider === provider);
    
    // 3. Check if all requested scopes are granted
    const hasAllScopes = requestedScopes.every(scope => 
      providerScopes.some(grant => grant.scopes.includes(scope))
    );
    
    // 4. Check for scope escalation attempts
    const escalationAttempt = await this.detectEscalation(userId, agentId, requestedScopes);
    
    // 5. Log and return result
    return {
      allowed: hasAllScopes && !escalationAttempt,
      reason: !hasAllScopes ? 'INSUFFICIENT_SCOPES' : 'ESCALATION_ATTEMPT',
      grantedScopes: providerScopes.flatMap(g => g.scopes),
      requestedScopes
    };
  }

  /**
   * Detect scope escalation attempts.
   * An escalation occurs when an agent requests scopes that:
   * 1. Were never granted to this user-agent pair, OR
   * 2. Were previously granted but revoked, OR
   * 3. Exceed the maximum risk level allowed for this agent
   */
  private async detectEscalation(
    userId: string,
    agentId: string,
    requestedScopes: string[]
  ): Promise<boolean> {
    // Get historical grants (including revoked)
    const historicalGrants = await this.getHistoricalGrants(userId, agentId);
    const everGrantedScopes = new Set(historicalGrants.flatMap(g => g.scopes));
    
    // Check for previously-never-granted scopes
    const neverGranted = requestedScopes.some(s => !everGrantedScopes.has(s));
    if (neverGranted) return true;
    
    // Check if any currently-revoked scopes are being requested
    const revokedScopes = historicalGrants
      .filter(g => g.revokedAt !== null)
      .flatMap(g => g.scopes);
    const requestingRevoked = requestedScopes.some(s => revokedScopes.includes(s));
    if (requestingRevoked) return true;
    
    // Check risk level ceiling for this agent
    const agentMaxRisk = await this.getAgentMaxRiskLevel(agentId);
    const scopeRisks = await this.getScopeRiskLevels(requestedScopes);
    const exceedingRisk = scopeRisks.some(r => this.riskRank(r) > this.riskRank(agentMaxRisk));
    if (exceedingRisk) return true;
    
    return false;
  }
  
  private riskRank(level: string): number {
    return { low: 1, medium: 2, high: 3 }[level] || 0;
  }
}
```

### 5. Credential Management System

**Credential Storage Strategy:**

```typescript
// Encryption hierarchy
const encryptionHierarchy = {
  // Level 1: Master key (AWS KMS)
  masterKey: 'aws:kms:master-key',
  
  // Level 2: Database encryption key (encrypted by master)
  databaseKey: 'aes-256:database-key',
  
  // Level 3: Field-level encryption (encrypted by database key)
  oauthTokens: 'aes-256-gcm:encrypted-tokens',
  apiKeys: 'aes-256-gcm:encrypted-keys'
};
```

**Token Lifecycle:**

```typescript
class TokenLifecycleManager {
  async manageTokenLifecycle(userId: string, provider: string) {
    const token = await this.getToken(userId, provider);
    
    // Proactive refresh (5 minutes before expiry)
    if (this.shouldRefreshProactively(token)) {
      await this.refreshToken(userId, provider);
    }
    
    // Reactive refresh (on 401)
    if (this.isTokenExpired(token)) {
      await this.refreshToken(userId, provider);
    }
    
    // Token cleanup (revoked/expired)
    await this.cleanupExpiredTokens();
  }
}
```

### 6. Audit & Compliance System

**Audit Log Schema:**

```typescript
interface AuditLog {
  id: string;
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  agentId?: string;
  ipAddress: string;
  userAgent: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure' | 'blocked';
  details: Record<string, any>;
  sessionId?: string;
}

enum AuditEventType {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  TOKEN_REFRESH = 'token_refresh',
  API_CALL = 'api_call',
  SCOPE_VIOLATION = 'scope_violation',
  CONFIGURATION_CHANGE = 'configuration_change',
  SECURITY_EVENT = 'security_event'
}
```

**Audit Implementation:**

```typescript
class AuditLogger {
  async log(event: Omit<AuditLog, 'id' | 'timestamp'>) {
    const auditLog: AuditLog = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };
    
    // Write to database
    await this.db.auditLogs.create(auditLog);
    
    // Stream to SIEM (if configured)
    if (this.siemClient) {
      await this.siemClient.send(auditLog);
    }
    
    // Alert on security events
    if (this.isSecurityEvent(event)) {
      await this.alertService.send(event);
    }
  }
}
```

### 7. Database Schema

**Core Tables:**

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  api_key_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User-Agent grants
CREATE TABLE user_agent_grants (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  granted_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  PRIMARY KEY (user_id, agent_id)
);

-- OAuth tokens (encrypted)
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMP,
  scopes TEXT[] NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- API keys (encrypted)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,
  key_encrypted TEXT NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  UNIQUE(user_id, provider)
);

-- Service accounts
CREATE TABLE service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  permissions TEXT[] NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  user_id UUID REFERENCES users(id),
  agent_id UUID REFERENCES agents(id),
  ip_address INET,
  user_agent TEXT,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(255),
  outcome VARCHAR(20) NOT NULL,
  details JSONB,
  session_id UUID
);

-- Indexes for performance
CREATE INDEX idx_oauth_tokens_user_provider ON oauth_tokens(user_id, provider);
CREATE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider);
CREATE INDEX idx_user_agent_grants_user ON user_agent_grants(user_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
```

## Security Architecture

### 1. Encryption Strategy

**Data at Rest:**
- OAuth tokens: AES-256-GCM with per-user keys
- API keys: AES-256-GCM with per-user keys
- Database: TDE (Transparent Data Encryption)

**Data in Transit:**
- TLS 1.3 for all external communication
- mTLS for internal service communication
- Certificate pinning for critical endpoints

**Key Management:**
- AWS KMS for master keys
- Key rotation every 90 days
- Key separation by environment

### 2. Network Security

**Network Isolation:**
```
┌─────────────────────────────────────────┐
│              Public Subnet              │
│  ┌─────────────────────────────────────┐│
│  │       Load Balancer (ALB)           ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│            Private Subnet               │
│  ┌─────────────────────────────────────┐│
│  │     agent-auth-proxy instances      ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         Isolated Private Subnet         │
│  ┌─────────────────────────────────────┐│
│  │        PostgreSQL (RDS)             ││
│  │          Redis (ElastiCache)        ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

**Security Groups:**
- ALB: Allow 443 from 0.0.0.0/0
- Proxy: Allow 3000 from ALB only
- Database: Allow 5432 from proxy only
- Redis: Allow 6379 from proxy only

### 3. Authentication Flow

**OAuth2 Authorization Code Flow with PKCE:**

```
1. Agent initiates user authorization
   Agent → Proxy: POST /oauth/authorize?user_id=123&provider=google&scopes=email,profile
   
2. Proxy generates PKCE challenge
   Proxy → User: Redirect to Google with code_challenge
   
3. User authorizes on provider
   User → Provider: Login and grant permissions
   Provider → Proxy: Redirect with authorization code
   
4. Proxy exchanges code for tokens
   Proxy → Provider: POST /token with code + code_verifier
   Provider → Proxy: { access_token, refresh_token, expires_in }
   
5. Proxy encrypts and stores tokens
   Proxy → Database: Store encrypted tokens
   
6. Agent makes API calls
   Agent → Proxy: API call with user context
   Proxy → Provider: API call with user's access token
```

### 4. CORS Strategy

**Proxy API CORS:**
- `Access-Control-Allow-Origin`: Configured via `ALLOWED_ORIGINS` env var (no wildcards in production)
- `Access-Control-Allow-Methods`: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers`: `Authorization, X-User-ID, X-Admin-API-Key, Content-Type`
- `Access-Control-Max-Age`: 86400 seconds
- Credentials: not allowed (agents use Bearer tokens, not cookies)

**OAuth Callback CORS:**
- OAuth callback endpoints (`/oauth/:provider/callback`) do not enable CORS
- Callbacks are server-to-server redirects, not XHR/fetch calls
- The callback handler validates the `state` parameter and then redirects to a configured success/failure URL

**Management API CORS:**
- Restricted to admin dashboard origins only
- Preflight requests require valid admin authentication

### 4. Rate Limiting Strategy

**Multi-Level Rate Limiting:**

```typescript
const rateLimits = {
  // Per IP address
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // 1000 requests per window
  },
  
  // Per user
  perUser: {
    windowMs: 60 * 1000, // 1 minute
    max: 100 // 100 requests per minute per user
  },
  
  // Per agent
  perAgent: {
    windowMs: 60 * 1000, // 1 minute
    max: 500 // 500 requests per minute per agent
  },
  
  // Token refresh (more restrictive)
  tokenRefresh: {
    windowMs: 60 * 1000, // 1 minute
    max: 10 // 10 refreshes per minute per user
  }
};
```

## Deployment Architecture

### 1. Container Orchestration

**Docker Compose (Development):**
```yaml
version: '3.8'
services:
  proxy:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://user:pass@db:5432/agent_auth
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
  
  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=agent_auth
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

**Kubernetes (Production):**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-auth-proxy
spec:
  replicas: 3
  selector:
    matchLabels:
      app: agent-auth-proxy
  template:
    metadata:
      labels:
        app: agent-auth-proxy
    spec:
      containers:
      - name: proxy
        image: agent-auth-proxy:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 2. Scaling Strategy

**Horizontal Pod Autoscaler:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: agent-auth-proxy-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: agent-auth-proxy
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 3. High Availability

**Multi-AZ Deployment:**
- Proxy instances across 3 availability zones
- Database with multi-AZ failover
- Redis Cluster for high availability
- Load balancer with health checks

**Disaster Recovery:**
- Automated backups (daily full, hourly incremental)
- Point-in-time recovery (30 days)
- Cross-region replication for critical data
- RTO: 1 hour, RPO: 5 minutes

## Monitoring & Observability

### 1. Metrics Collection

**Key Metrics:**
```typescript
const metrics = {
  // Performance
  request_duration_ms: 'histogram',
  request_count: 'counter',
  active_connections: 'gauge',
  
  // Authentication
  auth_success_count: 'counter',
  auth_failure_count: 'counter',
  token_refresh_count: 'counter',
  token_refresh_failure_count: 'counter',
  
  // Security
  scope_violation_count: 'counter',
  rate_limit_hit_count: 'counter',
  suspicious_activity_count: 'counter',
  
  // Business
  active_users: 'gauge',
  active_agents: 'gauge',
  api_calls_by_provider: 'counter'
};
```

### 2. Logging Strategy

**Log Levels:**
- ERROR: System failures, security incidents
- WARN: Recoverable errors, rate limits
- INFO: Important business events, auth events
- DEBUG: Detailed request/response information
- TRACE: Full request/response bodies (development only)

**Log Structure:**
```typescript
interface StructuredLog {
  timestamp: string;
  level: string;
  service: string;
  trace_id?: string;
  span_id?: string;
  user_id?: string;
  agent_id?: string;
  action: string;
  outcome: string;
  duration_ms?: number;
  error?: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}
```

### 3. Alerting

**Critical Alerts:**
- Service downtime (> 1 minute)
- High error rate (> 5%)
- Database connection failures
- Security breaches
- Token encryption failures

**Warning Alerts:**
- High latency (> 200ms p95)
- Rate limit approaching
- Token refresh failures
- Disk space > 80%
- Memory usage > 85%

## API Design

### 1. Proxy Endpoints

The proxy preserves the original HTTP method and passes through the request path to the downstream API. The proxy itself authenticates the agent and attaches the user's credentials.

**Request Format:**
```http
GET|POST|PUT|PATCH|DELETE /proxy/{provider}/{path...}?_scope={comma,separated,scopes}
Host: proxy.example.com
Authorization: Bearer {agent_jwt}
X-User-ID: {user_id}
Content-Type: application/json

{ ... request body forwarded as-is ... }
```

The agent identity is derived from the JWT — no `X-Agent-ID` header is required. Scopes are passed as the `_scope` query parameter (optional; when present, the server enforces that the requested scopes are a subset of what's been granted).

**Response Format:**
```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-ID: {uuid}
X-Duration-Ms: {duration}

{ ... response body forwarded as-is ... }
```

**Important:** The proxy forwards the downstream response status code, headers (with security-sensitive ones stripped), and body directly. It does not wrap responses in an envelope. This ensures compatibility with standard HTTP clients and SDKs.

**Streaming Support:** The proxy supports chunked transfer encoding and server-sent events (SSE). For SSE streams, the proxy maintains the connection and logs the stream start/end without buffering.

**Body Size Limits:**
- Maximum request body: 10MB
- Maximum response body (non-streaming): 50MB
- Streaming responses: Unlimited (within connection timeout)

### 2. Agent Authentication & Registration

Agents must authenticate to the proxy before making proxied requests. The proxy issues JWTs to registered agents.

**Agent Registration Flow:**
```
1. Admin creates agent record (api_key returned in the same response, shown once)
   POST /api/v1/agents
   Body: { name: "...", description?: "..." }
   → Returns { id, name, ..., api_key: "aap_..." }   # prefix: aap_

2. Agent exchanges API key for JWT (short-lived, e.g., 1 hour)
   POST /auth/agent
   Headers: Authorization: Bearer {agent_api_key}
   → Returns { token: {jwt}, agent: { id, name } }

3. Agent uses JWT for all proxied requests
   GET /proxy/google/calendar/v3/calendars/primary
   Headers: Authorization: Bearer {agent_jwt}, X-User-ID: {user_id}
   Query (optional): ?_scope=<comma,separated,scopes>
```

**Agent JWT Claims:**
```typescript
interface AgentJwtPayload {
  sub: string;        // agent_id
  iss: string;        // 'agent-auth-proxy'
  aud: string;        // 'agent-auth-proxy'
  iat: number;
  exp: number;
  jti: string;        // unique token id for revocation
}
```

### 3. Management API

**User Management:**
```
POST   /api/v1/users              # Create user
GET    /api/v1/users/:id          # Get user
DELETE /api/v1/users/:id          # Delete user
GET    /api/v1/users/:id/grants   # Get user's grants
```

**Agent Management:**
```
POST   /api/v1/agents             # Register agent — response includes one-time api_key
GET    /api/v1/agents/:id         # Get agent
DELETE /api/v1/agents/:id         # Delete agent
```

**Grant Management:**
```
POST   /api/v1/grants             # Create grant
GET    /api/v1/grants             # List grants
DELETE /api/v1/grants/:id         # Revoke grant
```

**Token Management (admin only):**
```
GET    /api/v1/tokens             # List tokens (metadata only, no secrets)
DELETE /api/v1/tokens/:id         # Revoke token
```

**Note:** There is no endpoint to retrieve decrypted OAuth tokens or API keys. Credentials are attached by the proxy internally and never exposed to agents.

## Error Handling

### 1. Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    request_id: string;
    timestamp: string;
  };
}
```

### 2. Error Codes

```typescript
enum ErrorCodes {
  // Authentication errors
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INVALID = 'AUTH_INVALID',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  
  // Authorization errors
  SCOPE_INSUFFICIENT = 'SCOPE_INSUFFICIENT',
  SCOPE_ESCALATION = 'SCOPE_ESCALATION',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  
  // Token errors
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REFRESH_FAILED = 'TOKEN_REFRESH_FAILED',
  
  // Proxy errors
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
  UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE',
  
  // System errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}
```

### 3. Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime?: Date;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = new Date();
    
    if (this.failures >= 5) {
      this.state = 'open';
    }
  }
  
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    const elapsed = Date.now() - this.lastFailureTime.getTime();
    return elapsed > 30000; // 30 seconds
  }
}
```

## Performance Considerations

### 1. Caching Strategy

**Token Cache (Redis):**
```typescript
const tokenCache = {
  // Cache valid tokens for 5 minutes
  ttl: 300,
  
  // Key format: token:{user_id}:{provider}:{scopes_hash}
  getKey: (userId, provider, scopes) => 
    `token:${userId}:${provider}:${this.hashScopes(scopes)}`,
  
  // Cache invalidation on token refresh
  invalidate: async (userId, provider) => 
    await redis.del(`token:${userId}:${provider}:*`)
};
```

**User Grant Cache:**
```typescript
const grantCache = {
  // Cache grants for 1 minute
  ttl: 60,
  
  // Key format: grants:{user_id}:{agent_id}
  getKey: (userId, agentId) => `grants:${userId}:${agentId}`,
  
  // Invalidate on grant changes
  invalidate: async (userId, agentId) => 
    await redis.del(`grants:${userId}:${agentId}`)
};
```

### 2. Database Optimization

**Connection Pooling:**
```typescript
const poolConfig = {
  max: 20, // Maximum connections
  min: 5,  // Minimum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};
```

**Query Optimization:**
- Use prepared statements
- Implement proper indexing
- Use connection pooling
- Implement read replicas for read-heavy workloads

### 3. Memory Management

**Memory Limits:**
```typescript
const memoryConfig = {
  // Node.js heap size
  maxOldSpaceSize: 512, // MB
  
  // Cache limits
  maxCacheSize: 100, // MB
  
  // Request size limits
  maxRequestBodySize: '1mb',
  maxHeadersCount: 100
};
```

## Future Enhancements

### 1. Advanced Features
- **Token Trading**: Exchange tokens between providers
- **Credential Bridging**: Map credentials across systems
- **Policy Engine**: Advanced authorization policies
- **Machine Learning**: Anomaly detection for security

### 2. Integration Capabilities
- **Webhook Support**: Real-time notifications
- **Event Streaming**: Kafka/EventBridge integration
- **GraphQL Support**: Unified API layer
- **gRPC Support**: High-performance microservices

### 3. Enterprise Features
- **SAML Integration**: Enterprise SSO
- **SCIM Support**: User provisioning
- **Advanced Audit**: Compliance reporting
- **Multi-Region**: Global deployment

## Conclusion

This architecture provides a secure, scalable, and performant foundation for the agent-auth-proxy system. The design emphasizes security through zero-trust principles, performance through efficient caching and connection management, and reliability through comprehensive monitoring and fault tolerance.

The modular design allows for incremental implementation and easy extension as requirements evolve. The use of industry-standard technologies and patterns ensures maintainability and reduces operational complexity.
