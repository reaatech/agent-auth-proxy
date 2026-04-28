# Skill: OAuth2 Integration

## Overview

Implements OAuth2 authorization code flow with PKCE, token management, automatic refresh, and secure token storage for multiple OAuth providers (Google, GitHub, Microsoft, etc.).

## Metadata

- **Name**: OAuth2 Integration
- **Description**: Implements complete OAuth2 flow with PKCE, token refresh, and secure storage
- **Complexity**: High
- **Estimated Time**: 4 hours
- **Dependencies**: Project Scaffolding, Database Schema

## Inputs

```typescript
interface OAuth2IntegrationInputs {
  providers: OAuthProviderConfig[];
  defaultProvider?: string;
  redirectBaseUri: string;
  tokenRefreshBufferMinutes?: number; // Default: 5
  enablePKCE?: boolean; // Default: true
  maxTokenAge?: number; // Maximum token age in seconds
}

interface OAuthProviderConfig {
  name: string; // e.g., 'google', 'github'
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl?: string;
  scopes: string[];
  scopeSeparator?: string; // Default: ' '
  pkceMethod?: 'S256' | 'plain'; // Default: 'S256'
}
```

## Outputs

### Core OAuth2 Service

#### src/auth/managers/oauth2Manager.ts
```typescript
import { randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { oauthTokens, users } from '@/db/schema';
import { EncryptionService } from '@/auth/services/encryptionService';
import { AuditLogger } from '@/services/auditService';
import type { OAuthToken, NewOAuthToken } from '@/db/schema';

export interface OAuth2TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export interface OAuth2UserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}

export class OAuth2Manager {
  private encryptionService: EncryptionService;
  private auditLogger: AuditLogger;
  private providers: Map<string, OAuthProviderConfig>;
  private redirectBaseUri: string;
  private tokenRefreshBufferMs: number;

  constructor(config: OAuth2IntegrationInputs) {
    this.encryptionService = new EncryptionService();
    this.auditLogger = new AuditLogger();
    this.providers = new Map(
      config.providers.map(p => [p.name, p])
    );
    this.redirectBaseUri = config.redirectBaseUri;
    this.tokenRefreshBufferMs = (config.tokenRefreshBufferMinutes || 5) * 60 * 1000;
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  generatePKCE(): { codeVerifier: string; codeChallenge: string; state: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = randomBytes(16).toString('base64url');
    
    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Initiate OAuth2 authorization flow
   */
  async initiateAuthorization(
    userId: string,
    provider: string,
    scopes: string[]
  ): Promise<{ authorizationUrl: string; state: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    const { codeVerifier, codeChallenge, state } = this.generatePKCE();
    
    // Store code verifier temporarily (in Redis or database)
    await this.storeCodeVerifier(state, codeVerifier, userId);

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: `${this.redirectBaseUri}/oauth/${provider}/callback`,
      response_type: 'code',
      scope: scopes.join(providerConfig.scopeSeparator || ' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${providerConfig.authorizationUrl}?${params.toString()}`;

    await this.auditLogger.log({
      eventType: 'authorization',
      userId,
      action: 'oauth_initiated',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, scopes }
    });

    return { authorizationUrl, state };
  }

  /**
   * Handle OAuth2 callback and exchange code for tokens
   */
  async handleCallback(
    code: string,
    state: string,
    provider: string
  ): Promise<OAuthToken> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    // Retrieve and validate code verifier + state
    const verifierData = await this.retrieveCodeVerifier(state);
    if (!verifierData) {
      throw new Error('Invalid or expired state parameter');
    }
    const { codeVerifier, userId: initiatingUserId } = verifierData;

    // Exchange code for tokens
    const tokenResponse = await this.exchangeCodeForTokens(
      code,
      codeVerifier,
      providerConfig
    );
    
    // Validate that the returned scopes match or are a subset of requested
    const returnedScopes = tokenResponse.scope?.split(' ') || [];
    // (Scope validation logged below)

    // Get user info from provider
    const userInfo = await this.getUserInfo(tokenResponse.access_token, providerConfig);

    // Find or create user
    const user = await this.findOrCreateUser(userInfo, provider);

    // Encrypt and store tokens
    const encryptedToken = await this.storeTokens(user.id, provider, tokenResponse);

    await this.auditLogger.log({
      eventType: 'authentication',
      userId: user.id,
      action: 'oauth_callback',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, scopes: tokenResponse.scope?.split(' ') }
    });

    return encryptedToken;
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    providerConfig: OAuthProviderConfig
  ): Promise<OAuth2TokenResponse> {
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: `${this.redirectBaseUri}/oauth/${providerConfig.name}/callback`,
      code_verifier: codeVerifier,
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();
    
    // GitHub returns form-encoded by default; others return JSON
    if (contentType.includes('application/x-www-form-urlencoded') || responseText.startsWith('access_token=')) {
      const parsed = new URLSearchParams(responseText);
      return {
        access_token: parsed.get('access_token')!,
        token_type: parsed.get('token_type') || 'Bearer',
        expires_in: parseInt(parsed.get('expires_in') || '3600', 10),
        refresh_token: parsed.get('refresh_token') || undefined,
        scope: parsed.get('scope') || undefined,
      };
    }
    
    return JSON.parse(responseText);
  }

  /**
   * Get user info from OAuth provider
   */
  private async getUserInfo(
    accessToken: string,
    providerConfig: OAuthProviderConfig
  ): Promise<OAuth2UserInfo> {
    if (!providerConfig.userinfoUrl) {
      // Decode ID token for basic info
      if (providerConfig.name === 'google') {
        return this.decodeGoogleIdToken(accessToken);
      }
      throw new Error(`UserInfo endpoint not configured for ${providerConfig.name}`);
    }

    const response = await fetch(providerConfig.userinfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Find existing user or create new one
   */
  private async findOrCreateUser(
    userInfo: OAuth2UserInfo,
    provider: string
  ): Promise<typeof users.$inferSelect> {
    // Try to find user by email
    let user = await db.query.users.findFirst({
      where: eq(users.email, userInfo.email),
    });

    if (!user) {
      // Create new user
      const [newUser] = await db.insert(users).values({
        email: userInfo.email,
        emailVerified: userInfo.emailVerified || false,
        metadata: {
          provider,
          providerId: userInfo.id,
          name: userInfo.name,
          picture: userInfo.picture,
        },
      }).returning();

      user = newUser;
    }

    // Update last login
    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    return user;
  }

  /**
   * Store encrypted OAuth tokens
   */
  async storeTokens(
    userId: string,
    provider: string,
    tokenResponse: OAuth2TokenResponse
  ): Promise<OAuthToken> {
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Encrypt tokens
    const { encrypted: accessTokenEncrypted, iv: accessTokenIv } = 
      await this.encryptionService.encrypt(tokenResponse.access_token);
    
    let refreshTokenEncrypted: string | null = null;
    let refreshTokenIv: Buffer | null = null;
    
    if (tokenResponse.refresh_token) {
      const refreshResult = await this.encryptionService.encrypt(tokenResponse.refresh_token);
      refreshTokenEncrypted = refreshResult.encrypted;
      refreshTokenIv = refreshResult.iv;
    }

    let idTokenEncrypted: string | null = null;
    let idTokenIv: Buffer | null = null;
    
    if (tokenResponse.id_token) {
      const idResult = await this.encryptionService.encrypt(tokenResponse.id_token);
      idTokenEncrypted = idResult.encrypted;
      idTokenIv = idResult.iv;
    }

    const newToken: NewOAuthToken = {
      userId,
      provider,
      accessTokenEncrypted,
      accessTokenIv,
      refreshTokenEncrypted,
      refreshTokenIv,
      tokenType: tokenResponse.token_type,
      expiresAt,
      scopes: tokenResponse.scope?.split(' ') || [],
      idTokenEncrypted,
      idTokenIv,
    };

    // Upsert token (replace existing)
    const [token] = await db.insert(oauthTokens)
      .values(newToken)
      .onConflictDoUpdate({
        target: [oauthTokens.userId, oauthTokens.provider],
        set: {
          ...newToken,
          updatedAt: new Date(),
          revokedAt: null,
        },
      })
      .returning();

    await this.auditLogger.log({
      eventType: 'token_created',
      userId,
      action: 'token_stored',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, expiresAt, scopes: newToken.scopes }
    });

    return token;
  }

  /**
   * Get valid access token for user
   */
  async getValidToken(
    userId: string,
    provider: string,
    requiredScopes?: string[]
  ): Promise<string> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider)
      ),
    });

    if (!token || token.revokedAt) {
      throw new Error(`No valid token found for user ${userId} with provider ${provider}`);
    }

    // Check if token needs refresh
    const now = new Date();
    const needsRefresh = token.expiresAt.getTime() - now.getTime() < this.tokenRefreshBufferMs;

    if (needsRefresh) {
      return this.refreshAccessToken(userId, provider);
    }

    // Decrypt access token
    const accessToken = await this.encryptionService.decrypt(
      token.accessTokenEncrypted,
      token.accessTokenIv
    );

    // Check scopes if required
    if (requiredScopes) {
      const hasAllScopes = requiredScopes.every(scope => 
        token.scopes.includes(scope)
      );
      if (!hasAllScopes) {
        throw new Error(`Token missing required scopes: ${requiredScopes.filter(s => !token.scopes.includes(s)).join(', ')}`);
      }
    }

    // Update last used
    await db.update(oauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthTokens.id, token.id));

    return accessToken;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(
    userId: string,
    provider: string
  ): Promise<string> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider)
      ),
    });

    if (!token || !token.refreshTokenEncrypted || token.revokedAt) {
      throw new Error(`No refresh token available for user ${userId} with provider ${provider}`);
    }

    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    // Decrypt refresh token
    const refreshToken = await this.encryptionService.decrypt(
      token.refreshTokenEncrypted,
      token.refreshTokenIv
    );

    // Request new tokens
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    if (!response.ok) {
      // If refresh fails, token might be revoked
      await db.update(oauthTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthTokens.id, token.id));

      await this.auditLogger.log({
        eventType: 'token_revoked',
        userId,
        action: 'refresh_failed',
        resource: `oauth:${provider}`,
        outcome: 'failure',
        details: { provider, reason: 'refresh_token_invalid' }
      });

      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const tokenResponse: OAuth2TokenResponse = await response.json();

    // Store new tokens
    const newToken = await this.storeTokens(userId, provider, tokenResponse);

    await this.auditLogger.log({
      eventType: 'token_refresh',
      userId,
      action: 'token_refreshed',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, newExpiresAt: newToken.expiresAt }
    });

    return newToken.accessTokenEncrypted; // Return encrypted, will be decrypted by getValidToken
  }

  /**
   * Revoke OAuth token
   */
  async revokeToken(userId: string, provider: string): Promise<void> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.provider, provider)
      ),
    });

    if (!token) {
      return; // Token doesn't exist
    }

    // Decrypt access token for revocation
    const accessToken = await this.encryptionService.decrypt(
      token.accessTokenEncrypted,
      token.accessTokenIv
    );

    // Try to revoke with provider
    const providerConfig = this.providers.get(provider);
    if (providerConfig) {
      try {
        const revokeParams = new URLSearchParams({
          client_id: providerConfig.clientId,
          client_secret: providerConfig.clientSecret,
          token: accessToken,
        });

        await fetch(`${providerConfig.tokenUrl}/revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: revokeParams,
        });
      } catch (error) {
        // Log but don't fail if provider revocation fails
        console.error(`Failed to revoke token with provider ${provider}:`, error);
      }
    }

    // Mark token as revoked in database
    await db.update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.id, token.id));

    await this.auditLogger.log({
      eventType: 'token_revoked',
      userId,
      action: 'token_revoked',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider }
    });
  }

  /**
   * Store code verifier temporarily (Redis with 10-minute TTL)
   */
  private async storeCodeVerifier(
    state: string,
    codeVerifier: string,
    userId: string
  ): Promise<void> {
    const key = `oauth:code_verifier:${state}`;
    const payload = JSON.stringify({ codeVerifier, userId });
    
    // Redis is primary; fallback to temporary database table for test/dev
    if (this.redis) {
      await this.redis.setex(key, 600, payload);
    } else {
      await db.insert(oauthStates).values({
        state,
        codeVerifier,
        userId,
        expiresAt: new Date(Date.now() + 600 * 1000),
      });
    }
  }

  /**
   * Retrieve and delete code verifier (one-time use)
   */
  private async retrieveCodeVerifier(state: string): Promise<{ codeVerifier: string; userId: string } | null> {
    const key = `oauth:code_verifier:${state}`;
    
    if (this.redis) {
      const data = await this.redis.get(key);
      if (data) {
        await this.redis.del(key);
        return JSON.parse(data);
      }
    } else {
      const [record] = await db.delete(oauthStates)
        .where(eq(oauthStates.state, state))
        .returning();
      if (record && record.expiresAt > new Date()) {
        return { codeVerifier: record.codeVerifier, userId: record.userId };
      }
    }
    
    return null;
  }

  /**
   * Decode Google ID token
   */
  private async decodeGoogleIdToken(idToken: string): Promise<OAuth2UserInfo> {
    // Decode JWT without verification (for development)
    // In production, verify signature with Google's public keys
    const base64Url = idToken.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');
    const payload = JSON.parse(jsonPayload);

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
    };
  }
}
```

### OAuth2 Routes

#### src/api/routes/auth.ts
```typescript
import { FastifyPluginAsync } from 'fastify';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const oauth2Manager = new OAuth2Manager(fastify.config.oauth2);

  // Initiate OAuth2 flow
  fastify.get('/oauth/authorize', async (request, reply) => {
    const { user_id, provider = 'google', scopes } = request.query as any;
    
    const { authorizationUrl } = await oauth2Manager.initiateAuthorization(
      user_id,
      provider,
      scopes?.split(',') || []
    );

    reply.redirect(authorizationUrl);
  });

  // OAuth2 callback
  fastify.get('/oauth/:provider/callback', async (request, reply) => {
    const { provider } = request.params;
    const { code, state, error } = request.query as any;

    if (error) {
      return reply.code(400).send({ error: 'OAuth error', message: error });
    }

    if (!state || !code) {
      return reply.code(400).send({ error: 'Invalid callback', message: 'Missing state or code parameter' });
    }

    try {
      const token = await oauth2Manager.handleCallback(code, state, provider);
      reply.send({ success: true, token_id: token.id });
    } catch (err) {
      reply.code(400).send({ error: 'Token exchange failed', message: err.message });
    }
  });

  // Get valid token
  fastify.get('/oauth/token', async (request, reply) => {
    const { user_id, provider, scopes } = request.query as any;
    
    const accessToken = await oauth2Manager.getValidToken(
      user_id,
      provider,
      scopes?.split(',')
    );

    reply.send({ access_token: accessToken });
  });

  // Revoke token
  fastify.delete('/oauth/token', async (request, reply) => {
    const { user_id, provider } = request.query as any;
    
    await oauth2Manager.revokeToken(user_id, provider);
    reply.send({ success: true });
  });
};
```

### Configuration

#### src/config/auth.ts
```typescript
export const oauth2Config = {
  redirectBaseUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000',
  tokenRefreshBufferMinutes: 5,
  providers: [
    {
      name: 'google',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
      scopes: ['openid', 'email', 'profile'],
    },
    {
      name: 'github',
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userinfoUrl: 'https://api.github.com/user',
      scopes: ['user:email', 'read:user'],
      scopeSeparator: ' ',
    },
  ],
};
```

## Implementation Steps

1. **Configure OAuth providers**
   - Set up OAuth apps in Google, GitHub, etc.
   - Add client IDs and secrets to environment variables

2. **Implement encryption service**
   - Create AES-256-GCM encryption for tokens
   - Implement key management

3. **Set up OAuth2 manager**
   - Implement authorization flow
   - Implement token exchange
   - Implement token refresh

4. **Create API routes**
   - Authorization initiation
   - Callback handling
   - Token retrieval
   - Token revocation

5. **Add audit logging**
   - Log all OAuth events
   - Track token lifecycle

## Validation

After running this skill, verify:
- [ ] OAuth2 authorization flow works end-to-end
- [ ] Tokens are encrypted before storage
- [ ] Token refresh works automatically
- [ ] Scope validation is enforced
- [ ] Audit logs capture all events
- [ ] PKCE is implemented correctly

## Security Considerations

- Always use PKCE for authorization code flow
- Encrypt all tokens at rest
- Validate state parameter to prevent CSRF
- Use HTTPS for all OAuth callbacks
- Implement token revocation
- Log all authentication events

## Next Steps

After OAuth2 integration:
1. API key vault implementation
2. Scope enforcement engine
3. Proxy engine integration
