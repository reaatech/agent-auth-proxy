import { AuthError, ScopeError, ValidationError } from '@reaatech/agent-auth-proxy-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/agent-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AgentClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('rejects an apiKey that does not start with aap_', () => {
    expect(
      () =>
        new AgentClient({
          baseUrl: 'http://localhost:3000',
          apiKey: 'bad-key',
        }),
    ).toThrow(/aap_/);
  });

  it('authenticate() exchanges the API key for a session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-token', agent: { id: 'agent-1', name: 'bot' } }),
    );

    const client = new AgentClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'aap_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const session = await client.authenticate();

    expect(session.token).toBe('jwt-token');
    expect(session.agent).toEqual({ id: 'agent-1', name: 'bot' });
    expect(client.isAuthenticated()).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/auth/agent');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer aap_secret');
  });

  it('proxy() throws if not authenticated', async () => {
    const client = new AgentClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'aap_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.proxy({
        provider: 'google',
        path: 'calendar/v3/events',
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow(AuthError);
  });

  it('proxy() forwards JWT, X-User-ID, and scopes to the server', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ token: 'jwt-token', agent: { id: 'agent-1', name: 'bot' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ events: [] }));

    const client = new AgentClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'aap_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.authenticate();

    await client.proxy({
      provider: 'google',
      path: 'calendar/v3/events',
      userId: '00000000-0000-4000-8000-000000000001',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      'http://localhost:3000/proxy/google/calendar/v3/events?_scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly',
    );
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(init.headers['X-User-ID']).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('strips a leading slash from the proxy path', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ token: 'jwt-token', agent: { id: 'agent-1', name: 'bot' } }),
      )
      .mockResolvedValueOnce(jsonResponse({}));

    const client = new AgentClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'aap_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.authenticate();

    await client.proxy({
      provider: 'google',
      path: '/calendar/v3/events',
      userId: '00000000-0000-4000-8000-000000000001',
    });

    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe('http://localhost:3000/proxy/google/calendar/v3/events');
  });

  it('maps server error status codes to typed errors', async () => {
    const cases: {
      status: number;
      expected: typeof AuthError | typeof ScopeError | typeof ValidationError;
    }[] = [
      { status: 401, expected: AuthError },
      { status: 403, expected: ScopeError },
      { status: 400, expected: ValidationError },
    ];

    for (const { status, expected } of cases) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'X', message: 'failed' }, status));
      const client = new AgentClient({
        baseUrl: 'http://localhost:3000',
        apiKey: 'aap_secret',
        fetch: fetchMock as unknown as typeof fetch,
      });
      await expect(client.authenticate()).rejects.toBeInstanceOf(expected);
    }
  });

  it('health() hits /health', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: 'now' }));
    const client = new AgentClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'aap_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/health');
  });
});
