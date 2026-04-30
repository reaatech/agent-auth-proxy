import { HttpClient } from './http';
import type {
  Agent,
  AgentWithApiKey,
  Grant,
  HealthStatus,
  OAuthTokenSummary,
  Pagination,
  ReadinessStatus,
  User,
} from './types';

function paginationQuery(p: Pagination): Record<string, number | undefined> {
  return { limit: p.limit, offset: p.offset };
}

export interface AdminClientOptions {
  baseUrl: string;
  adminApiKey: string;
  fetch?: typeof fetch;
}

export interface CreateUserInput {
  email: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
}

export interface CreateGrantInput {
  userId: string;
  agentId: string;
  scopes: string[];
}

export class AdminClient {
  private readonly http: HttpClient;

  constructor(options: AdminClientOptions) {
    this.http = new HttpClient(
      options.baseUrl,
      () => ({ 'X-Admin-API-Key': options.adminApiKey }),
      options.fetch,
    );
  }

  // Users
  async createUser(input: CreateUserInput): Promise<User> {
    return this.http.request<User>('/users', { method: 'POST', body: input });
  }

  async getUser(id: string): Promise<User> {
    return this.http.request<User>(`/users/${id}`);
  }

  async deleteUser(id: string): Promise<void> {
    await this.http.request<void>(`/users/${id}`, { method: 'DELETE' });
  }

  async getUserGrants(id: string): Promise<Grant[]> {
    return this.http.request<Grant[]>(`/users/${id}/grants`);
  }

  // Agents
  async createAgent(input: CreateAgentInput): Promise<AgentWithApiKey> {
    return this.http.request<AgentWithApiKey>('/agents', { method: 'POST', body: input });
  }

  async getAgent(id: string): Promise<Agent> {
    return this.http.request<Agent>(`/agents/${id}`);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.http.request<void>(`/agents/${id}`, { method: 'DELETE' });
  }

  // Grants
  async createGrant(input: CreateGrantInput): Promise<Grant> {
    return this.http.request<Grant>('/grants', {
      method: 'POST',
      body: { user_id: input.userId, agent_id: input.agentId, scopes: input.scopes },
    });
  }

  async listGrants(pagination: Pagination = {}): Promise<Grant[]> {
    return this.http.request<Grant[]>('/grants', { query: paginationQuery(pagination) });
  }

  async deleteGrant(id: string): Promise<void> {
    await this.http.request<void>(`/grants/${id}`, { method: 'DELETE' });
  }

  // Tokens
  async listTokens(pagination: Pagination = {}): Promise<OAuthTokenSummary[]> {
    return this.http.request<OAuthTokenSummary[]>('/tokens', {
      query: paginationQuery(pagination),
    });
  }

  async deleteToken(id: string): Promise<void> {
    await this.http.request<void>(`/tokens/${id}`, { method: 'DELETE' });
  }

  // Health
  async health(): Promise<HealthStatus> {
    return this.http.request<HealthStatus>('/health');
  }

  async ready(): Promise<ReadinessStatus> {
    return this.http.request<ReadinessStatus>('/ready');
  }
}
