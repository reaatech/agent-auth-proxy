import { buildApp } from '@/app';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';
import { db } from '@/db';
import { users } from '@/db/schema';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('Auth Endpoints', () => {
  let app: ReturnType<typeof supertest>;
  let fastify: Awaited<ReturnType<typeof buildApp>>;

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

  it('should return 400 for invalid authorize query', async () => {
    const res = await app
      .get('/oauth/authorize')
      .query({ user_id: 'bad-uuid', provider: 'google', scopes: 'email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_QUERY');
  });

  it('should return 400 for unknown provider in authorize', async () => {
    const res = await app.get('/oauth/authorize').query({
      user_id: '00000000-0000-4000-8000-000000000001',
      provider: 'unknown',
      scopes: 'email',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OAUTH_INITIATE_FAILED');
  });

  it('should initiate authorization for valid request', async () => {
    await db
      .insert(users)
      .values({ id: '00000000-0000-4000-8000-000000000003', email: 'auth@example.com' })
      .onConflictDoNothing();
    const res = await app.get('/oauth/authorize').query({
      user_id: '00000000-0000-4000-8000-000000000003',
      provider: 'google',
      scopes: 'email,profile',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('should return 400 for invalid callback params', async () => {
    const res = await app.get('/oauth/google/callback').query({ code: '123', state: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TOKEN_EXCHANGE_FAILED');
  });

  it('should return 400 for OAuth error callback', async () => {
    const res = await app.get('/oauth/google/callback').query({ error: 'access_denied' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OAUTH_ERROR');
  });

  it('should return 400 for missing state or code', async () => {
    const res = await app.get('/oauth/google/callback').query({ state: 'only-state' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_CALLBACK');
  });

  it('should handle callback with valid state', async () => {
    const userId = '00000000-0000-4000-8000-000000000004';
    await db
      .insert(users)
      .values({ id: userId, email: 'callback@example.com' })
      .onConflictDoNothing();

    const manager = new OAuth2Manager({
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

    const { state } = await manager.initiateAuthorization(userId, 'google', ['email']);

    vi.stubGlobal('fetch', async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('token')) {
        return new Response(
          JSON.stringify({ access_token: 'test-access', token_type: 'Bearer', expires_in: 3600 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (urlStr.includes('userinfo')) {
        return new Response(JSON.stringify({ id: 'u1', email: 'callback@example.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const res = await app.get('/oauth/google/callback').query({ code: 'auth-code', state });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
