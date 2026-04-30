export interface User {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  apiKeyPrefix: string;
  active: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWithApiKey extends Agent {
  api_key: string;
}

export interface Grant {
  id: string;
  userId: string;
  agentId: string;
  scopes: string[];
  grantedAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
}

export interface OAuthTokenSummary {
  id: string;
  userId: string;
  provider: string;
  scopes: string[];
  expiresAt?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export interface AgentSession {
  token: string;
  agent: { id: string; name: string };
}

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export interface ReadinessStatus {
  status: 'ready' | 'not_ready';
  database: 'connected' | 'disconnected';
}

export interface Pagination {
  limit?: number;
  offset?: number;
}
