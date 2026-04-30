import {
  AppError,
  AuthError,
  ScopeError,
  UpstreamError,
  ValidationError,
} from '@reaatech/agent-auth-proxy-core';

interface ServerErrorBody {
  error?: string;
  message?: string;
}

type QueryValue = string | number | undefined;
type QueryInput = Record<string, QueryValue> | { [key: string]: QueryValue };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  query?: QueryInput;
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: () => Record<string, string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = this.mergeHeaders(options.headers);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      body,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const data = contentType.includes('application/json')
      ? ((await response.json()) as unknown)
      : await response.text();

    if (!response.ok) {
      throw this.toError(response.status, data);
    }

    return data as T;
  }

  async rawRequest(path: string, options: RequestOptions = {}): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const headers = this.mergeHeaders(options.headers);
    let body: string | undefined;
    if (options.body !== undefined && typeof options.body !== 'string') {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(options.body);
    } else if (typeof options.body === 'string') {
      body = options.body;
    }

    return this.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      body,
    });
  }

  private mergeHeaders(extra?: Record<string, string>): Record<string, string> {
    return { ...this.defaultHeaders(), ...(extra ?? {}) };
  }

  private buildUrl(path: string, query?: QueryInput): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private toError(status: number, data: unknown): Error {
    const body = (typeof data === 'object' && data !== null ? data : {}) as ServerErrorBody;
    const code = body.error ?? `HTTP_${status}`;
    const message = body.message ?? `Request failed with status ${status}`;

    if (status === 401) return new AuthError(code, message);
    if (status === 403) return new ScopeError(code, message);
    if (status === 400) return new ValidationError(message, { code });
    if (status === 502 || status === 503 || status === 504) return new UpstreamError(message);
    return new AppError(code, message, status);
  }
}
