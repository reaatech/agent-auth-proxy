import { AuthError } from '@reaatech/agent-auth-proxy-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminClient } from '../src/admin-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

describe('AdminClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: AdminClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new AdminClient({
      baseUrl: 'http://localhost:3000',
      adminApiKey: 'admin-key',
      fetch: fetchMock as unknown as typeof fetch,
    });
  });

  it('createUser sends POST /users with admin header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'u1',
        email: 'a@b.com',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }),
    );

    const user = await client.createUser({ email: 'a@b.com' });

    expect(user.id).toBe('u1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/users');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Admin-API-Key']).toBe('admin-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.com' }));
  });

  it('createGrant maps userId/agentId to snake_case', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'g1',
        userId: 'u1',
        agentId: 'a1',
        scopes: ['read'],
        grantedAt: '2026-01-01',
      }),
    );

    await client.createGrant({ userId: 'u1', agentId: 'a1', scopes: ['read'] });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      user_id: 'u1',
      agent_id: 'a1',
      scopes: ['read'],
    });
  });

  it('listGrants forwards limit and offset as query params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await client.listGrants({ limit: 10, offset: 20 });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/grants?limit=10&offset=20');
  });

  it('deleteUser handles 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(noContentResponse());
    await expect(client.deleteUser('u1')).resolves.toBeUndefined();
  });

  it('rejects on 401 with AuthError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'ADMIN_REQUIRED', message: 'no' }, 403));
    await expect(client.createUser({ email: 'a@b.com' })).rejects.toThrow();
  });

  it('treats 401 from server as AuthError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'AUTH', message: 'bad' }, 401));
    await expect(client.createUser({ email: 'a@b.com' })).rejects.toBeInstanceOf(AuthError);
  });
});
