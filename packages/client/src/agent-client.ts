import { AuthError } from '@reaatech/agent-auth-proxy-core';
import { HttpClient } from './http';
import type { AgentSession, HealthStatus, ReadinessStatus } from './types';

export interface AgentClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface ProxyOptions {
  provider: string;
  path: string;
  userId: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  scopes?: string[];
  headers?: Record<string, string>;
  body?: string | object;
}

export class AgentClient {
  private readonly http: HttpClient;
  private readonly apiKey: string;
  private session: AgentSession | null = null;

  constructor(options: AgentClientOptions) {
    if (!options.apiKey.startsWith('aap_')) {
      throw new Error('apiKey must be a valid agent API key (starts with "aap_")');
    }
    this.apiKey = options.apiKey;
    this.http = new HttpClient(
      options.baseUrl,
      (): Record<string, string> =>
        this.session ? { Authorization: `Bearer ${this.session.token}` } : {},
      options.fetch,
    );
  }

  async authenticate(): Promise<AgentSession> {
    const session = await this.http.request<AgentSession>('/auth/agent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    this.session = session;
    return session;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  getSession(): AgentSession | null {
    return this.session;
  }

  async proxy(options: ProxyOptions): Promise<Response> {
    if (!this.session) {
      throw new AuthError('NOT_AUTHENTICATED', 'Call authenticate() before proxy()');
    }

    const path = `/proxy/${options.provider}/${options.path.replace(/^\//, '')}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.session.token}`,
      'X-User-ID': options.userId,
      ...options.headers,
    };

    const query = options.scopes?.length ? { _scope: options.scopes.join(',') } : undefined;

    return this.http.rawRequest(path, {
      method: options.method,
      headers,
      query,
      body: options.body as unknown,
    });
  }

  async health(): Promise<HealthStatus> {
    return this.http.request<HealthStatus>('/health');
  }

  async ready(): Promise<ReadinessStatus> {
    return this.http.request<ReadinessStatus>('/ready');
  }
}
