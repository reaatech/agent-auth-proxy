import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '@/app';
import { KeyVault } from '@/auth/managers/keyVault';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';
import { db } from '@/db';
import { scopes } from '@/db/schema';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('Proxy Endpoints', () => {
  let app: ReturnType<typeof supertest>;
  let fastify: Awaited<ReturnType<typeof buildApp>>;
  const adminKey = 'test-admin-api-key-secret-32b!!';

  beforeAll(async () => {
    fastify = await buildApp();
    await fastify.ready();
    app = supertest(fastify.server);
  });

  afterAll(async () => {
    await fastify.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getAgentToken(): Promise<{ userId: string; agentId: string; token: string }> {
    const userRes = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: `agent-${Date.now()}@example.com` });
    const agentRes = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: `agent-${Date.now()}` });
    const authRes = await app
      .post('/auth/agent')
      .set('Authorization', `Bearer ${agentRes.body.api_key}`);
    return { userId: userRes.body.id, agentId: agentRes.body.id, token: authRes.body.token };
  }

  it('should return 400 without X-User-ID', async () => {
    const { token } = await getAgentToken();
    const res = await app
      .get('/proxy/google/calendar/v3/calendars')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_USER_ID');
  });

  it('should return 401 with no credentials', async () => {
    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });

    const res = await app
      .get('/proxy/google/calendar/v3/calendars')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('NO_CREDENTIALS');
  });

  it('should return 400 for unknown provider', async () => {
    const { userId, token } = await getAgentToken();
    const vault = new KeyVault();
    await vault.storeApiKey(userId, 'unknown-provider', 'sk-test-key');

    const res = await app
      .get('/proxy/unknown-provider/some/path')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('not supported');
  });

  it('should return 502 for upstream error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Network error');
    });

    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
    const vault = new KeyVault();
    await vault.storeApiKey(userId, 'google', 'sk-test-google-key');

    const res = await app
      .get('/proxy/google/calendar/v3/calendars')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('UPSTREAM_ERROR');
  });

  it('should refresh OAuth token on 401 and retry', async () => {
    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });

    const oauthManager = new OAuth2Manager({
      redirectBaseUri: 'http://localhost:3000',
      providers: [
        {
          name: 'google',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
          scopes: ['openid', 'email', 'profile'],
        },
      ],
    });
    await oauthManager.storeTokens(userId, 'google', {
      access_token: 'old-access',
      token_type: 'Bearer',
      expires_in: 1,
      refresh_token: 'refresh-xyz',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    });

    let callCount = 0;
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'new-access',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'refresh-xyz',
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
      }
      return new Response(JSON.stringify({ calendars: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const res = await app
      .get('/proxy/google/calendar/v3/calendars')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ calendars: [] });
  });

  it('should proxy request with mocked downstream', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ calendars: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });

    const vault = new KeyVault();
    await vault.storeApiKey(userId, 'google', 'sk-test-google-key-12345');

    const res = await app
      .get('/proxy/google/calendar/v3/calendars')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ calendars: [] });
  });

  it('should forward POST body to downstream', async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      capturedBody = init?.body as string | undefined;
      return new Response(JSON.stringify({ id: 'event-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });

    const vault = new KeyVault();
    await vault.storeApiKey(userId, 'google', 'sk-test-google-key-12345');

    const res = await app
      .post('/proxy/google/calendar/v3/calendars/primary/events')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' })
      .send({ summary: 'Test Event', start: { dateTime: '2024-01-01T00:00:00Z' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'event-123' });
    expect(capturedBody).toBeDefined();
    if (!capturedBody) throw new Error('capturedBody undefined');
    expect(JSON.parse(capturedBody)).toEqual({
      summary: 'Test Event',
      start: { dateTime: '2024-01-01T00:00:00Z' },
    });
  });

  it('should handle streaming response', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: hello\n\n'));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'transfer-encoding': 'chunked',
          },
        }),
    );

    const { userId, agentId, token } = await getAgentToken();
    await db
      .insert(scopes)
      .values({
        name: 'https://www.googleapis.com/auth/calendar.readonly',
        provider: 'google',
        category: 'calendar',
        riskLevel: 'low',
      })
      .onConflictDoNothing();
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userId,
        agent_id: agentId,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });

    const vault = new KeyVault();
    await vault.storeApiKey(userId, 'google', 'sk-test-google-key-12345');

    const res = await app
      .get('/proxy/google/calendar/v3/events/watch')
      .set('X-User-ID', userId)
      .set('Authorization', `Bearer ${token}`)
      .query({ _scope: 'https://www.googleapis.com/auth/calendar.readonly' });

    expect(res.status).toBe(200);
  });
});
