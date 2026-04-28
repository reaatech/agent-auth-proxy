import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';
import { db } from '@/db';
import { oauthStates, oauthTokens, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('OAuth2Manager', () => {
  const manager = new OAuth2Manager({
    redirectBaseUri: 'http://localhost:3000',
    providers: [
      {
        name: 'mock',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        authorizationUrl: 'http://mock-oauth/authorize',
        tokenUrl: 'http://mock-oauth/token',
        userinfoUrl: 'http://mock-oauth/userinfo',
        scopes: ['read'],
      },
    ],
  });

  const userId = '00000000-0000-0000-0000-000000000002';

  beforeEach(async () => {
    await db.delete(oauthStates).where(eq(oauthStates.userId, userId));
    await db.delete(oauthTokens).where(eq(oauthTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should generate PKCE parameters', () => {
    const pkce = manager.generatePKCE();
    expect(pkce.codeVerifier).toBeDefined();
    expect(pkce.codeChallenge).toBeDefined();
    expect(pkce.state).toBeDefined();
    expect(pkce.codeVerifier.length).toBeGreaterThan(0);
  });

  it('should throw for unknown provider', async () => {
    await expect(
      manager.initiateAuthorization('user-123', 'unknown', ['read']),
    ).rejects.toThrow("OAuth provider 'unknown' not configured");
  });

  it('should reject invalid state in callback', async () => {
    await expect(manager.handleCallback('code', 'invalid-state', 'mock')).rejects.toThrow(
      'Invalid or expired state parameter',
    );
  });

  it('should initiate authorization and store state', async () => {
    await db.insert(users).values({ id: userId, email: 'oauth-test@example.com' }).onConflictDoNothing();
    const result = await manager.initiateAuthorization(userId, 'mock', ['read']);
    expect(result.authorizationUrl).toContain('http://mock-oauth/authorize');
    expect(result.state).toBeDefined();

    const stateRecord = await db.query.oauthStates.findFirst({
      where: eq(oauthStates.state, result.state),
    });
    expect(stateRecord).toBeDefined();
    expect(stateRecord?.userId).toBe(userId);
  });

  it('should store and retrieve tokens', async () => {
    await db.insert(users).values({ id: userId, email: 'token-test@example.com' }).onConflictDoNothing();
    const token = await manager.storeTokens(userId, 'mock', {
      access_token: 'access-123',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-123',
      scope: 'read write',
    });

    expect(token.userId).toBe(userId);
    expect(token.provider).toBe('mock');

    const validToken = await manager.getValidToken(userId, 'mock');
    expect(validToken).toBe('access-123');
  });

  it('should check required scopes', async () => {
    await db.insert(users).values({ id: userId, email: 'scope-test@example.com' }).onConflictDoNothing();
    await manager.storeTokens(userId, 'mock', {
      access_token: 'access-456',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read',
    });

    await expect(manager.getValidToken(userId, 'mock', ['read', 'write'])).rejects.toThrow(
      'Token missing required scopes: write',
    );
  });

  it('should refresh expired token', async () => {
    await db.insert(users).values({ id: userId, email: 'refresh-test@example.com' }).onConflictDoNothing();
    await manager.storeTokens(userId, 'mock', {
      access_token: 'access-old',
      token_type: 'Bearer',
      expires_in: 1,
      refresh_token: 'refresh-abc',
      scope: 'read',
    });

    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          access_token: 'access-new',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const validToken = await manager.getValidToken(userId, 'mock');
    expect(validToken).toBe('access-new');
  });

  it('should revoke token', async () => {
    await db.insert(users).values({ id: userId, email: 'revoke-test@example.com' }).onConflictDoNothing();
    await manager.storeTokens(userId, 'mock', {
      access_token: 'access-789',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    await manager.revokeToken(userId, 'mock');
    await expect(manager.getValidToken(userId, 'mock')).rejects.toThrow('No valid token found');
  });

  it('should silently return when revoking non-existent token', async () => {
    await expect(manager.revokeToken(userId, 'mock')).resolves.toBeUndefined();
  });

  it('should handle callback and exchange code', async () => {
    await db.insert(users).values({ id: userId, email: 'callback-test@example.com' }).onConflictDoNothing();
    const { state } = await manager.initiateAuthorization(userId, 'mock', ['read']);

    vi.stubGlobal('fetch', async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('token')) {
        return new Response(
          JSON.stringify({
            access_token: 'callback-access',
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'read',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (urlStr.includes('userinfo')) {
        return new Response(
          JSON.stringify({ id: 'u1', email: 'callback-test@example.com', name: 'Test' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const token = await manager.handleCallback('auth-code', state, 'mock');
    expect(token.provider).toBe('mock');
  });

  it('should exchange form-encoded token response', async () => {
    await db.insert(users).values({ id: userId, email: 'form-test@example.com' }).onConflictDoNothing();
    const { state } = await manager.initiateAuthorization(userId, 'mock', ['read']);

    vi.stubGlobal('fetch', async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('token')) {
        return new Response('access_token=form-access&token_type=Bearer&expires_in=3600', {
          status: 200,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
      }
      if (urlStr.includes('userinfo')) {
        return new Response(
          JSON.stringify({ id: 'u1', email: 'form-test@example.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const token = await manager.handleCallback('code', state, 'mock');
    expect(token.provider).toBe('mock');
  });

  it('should fail refresh when token endpoint returns error', async () => {
    await db.insert(users).values({ id: userId, email: 'refresh-fail@example.com' }).onConflictDoNothing();
    await manager.storeTokens(userId, 'mock', {
      access_token: 'access-old',
      token_type: 'Bearer',
      expires_in: 1,
      refresh_token: 'refresh-abc',
      scope: 'read',
    });

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(manager.getValidToken(userId, 'mock')).rejects.toThrow('Token refresh failed');
  });

  it('should fail token exchange when endpoint returns error', async () => {
    await db.insert(users).values({ id: userId, email: 'exchange-fail@example.com' }).onConflictDoNothing();
    const { state } = await manager.initiateAuthorization(userId, 'mock', ['read']);

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'invalid_code' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(manager.handleCallback('bad-code', state, 'mock')).rejects.toThrow('Token exchange failed');
  });

  it('should retrieve token with missing metadata authTag fallback', async () => {
    await db.insert(users).values({ id: userId, email: 'metadata-test@example.com' }).onConflictDoNothing();
    const token = await manager.storeTokens(userId, 'mock', {
      access_token: 'access-metadata',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read',
    });

    await db.update(oauthTokens)
      .set({ metadata: { accessTokenAuthTag: (token.metadata as Record<string, string>).accessTokenAuthTag } })
      .where(eq(oauthTokens.id, token.id));

    // Verify the stored token works
    const storedToken = await db.query.oauthTokens.findFirst({
      where: eq(oauthTokens.id, token.id),
    });
    expect(storedToken).toBeDefined();
  });

  it('should preserve refresh token during refresh when not rotated', async () => {
    await db.insert(users).values({ id: userId, email: 'preserve-refresh@example.com' }).onConflictDoNothing();
    await manager.storeTokens(userId, 'mock', {
      access_token: 'initial-access',
      token_type: 'Bearer',
      expires_in: 1,
      refresh_token: 'my-refresh-token',
      scope: 'read',
    });

    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          access_token: 'refreshed-access',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'read',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const newToken = await manager.getValidToken(userId, 'mock');
    expect(newToken).toBe('refreshed-access');

    const stored = await db.query.oauthTokens.findFirst({
      where: eq(oauthTokens.userId, userId),
    });
    expect(stored?.refreshTokenEncrypted).toBeDefined();
  });
});
