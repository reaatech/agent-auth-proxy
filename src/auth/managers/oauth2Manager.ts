import { randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { oauthTokens, oauthStates, users } from '@/db/schema';
import { EncryptionService } from '@/auth/services/encryptionService';
import { AuditLogger, getAuditLogger } from '@/services/auditService';
import type { OAuthToken, NewOAuthToken } from '@/db/schema';

export interface OAuthProviderConfig {
  name: string;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl?: string;
  scopes: string[];
  scopeSeparator?: string;
}

export interface OAuth2IntegrationInputs {
  providers: OAuthProviderConfig[];
  redirectBaseUri: string;
  tokenRefreshBufferMinutes?: number;
}

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
  private refreshLocks: Map<string, Promise<string>>;

  constructor(config: OAuth2IntegrationInputs) {
    this.encryptionService = new EncryptionService();
    this.auditLogger = getAuditLogger();
    this.providers = new Map(config.providers.map(p => [p.name, p]));
    this.redirectBaseUri = config.redirectBaseUri;
    this.tokenRefreshBufferMs = (config.tokenRefreshBufferMinutes || 5) * 60 * 1000;
    this.refreshLocks = new Map();
  }

  generatePKCE(): { codeVerifier: string; codeChallenge: string; state: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    return { codeVerifier, codeChallenge, state };
  }

  async initiateAuthorization(
    userId: string,
    provider: string,
    scopes: string[],
  ): Promise<{ authorizationUrl: string; state: string }> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    const { codeVerifier, codeChallenge, state } = this.generatePKCE();
    await this.storeCodeVerifier(state, codeVerifier, userId);

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: `${this.redirectBaseUri}/oauth/${provider}/callback`,
      response_type: 'code',
      scope: scopes.join(providerConfig.scopeSeparator || ' '),
      state,
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
      details: { provider, scopes },
    });

    return { authorizationUrl, state };
  }

  async handleCallback(code: string, state: string, provider: string): Promise<OAuthToken> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    const verifierData = await this.retrieveCodeVerifier(state);
    if (!verifierData) {
      throw new Error('Invalid or expired state parameter');
    }
    const { codeVerifier } = verifierData;

    const tokenResponse = await this.exchangeCodeForTokens(code, codeVerifier, providerConfig);
    const userInfo = await this.getUserInfo(tokenResponse.access_token, providerConfig);
    const user = await this.findOrCreateUser(userInfo, provider);
    const encryptedToken = await this.storeTokens(user.id, provider, tokenResponse);

    await this.auditLogger.log({
      eventType: 'authentication',
      userId: user.id,
      action: 'oauth_callback',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, scopes: tokenResponse.scope?.split(' ') },
    });

    return encryptedToken;
  }

  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    providerConfig: OAuthProviderConfig,
  ): Promise<OAuth2TokenResponse> {
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${this.redirectBaseUri}/oauth/${providerConfig.name}/callback`,
      code_verifier: codeVerifier,
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();

    if (
      contentType.includes('application/x-www-form-urlencoded') ||
      responseText.startsWith('access_token=')
    ) {
      const parsed = new URLSearchParams(responseText);
      return {
        access_token: parsed.get('access_token')!,
        token_type: parsed.get('token_type') || 'Bearer',
        expires_in: parseInt(parsed.get('expires_in') || '3600', 10),
        refresh_token: parsed.get('refresh_token') || undefined,
        scope: parsed.get('scope') || undefined,
      };
    }

    return JSON.parse(responseText) as OAuth2TokenResponse;
  }

  private async getUserInfo(
    accessToken: string,
    providerConfig: OAuthProviderConfig,
  ): Promise<OAuth2UserInfo> {
    if (!providerConfig.userinfoUrl) {
      throw new Error(`UserInfo endpoint not configured for ${providerConfig.name}`);
    }

    const response = await fetch(providerConfig.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: HTTP ${response.status}`);
    }

    return response.json() as Promise<OAuth2UserInfo>;
  }

  private async findOrCreateUser(userInfo: OAuth2UserInfo, provider: string) {
    let user = await db.query.users.findFirst({
      where: eq(users.email, userInfo.email),
    });

    if (!user) {
      const [newUser] = await db
        .insert(users)
        .values({
          email: userInfo.email,
          emailVerified: userInfo.emailVerified || false,
          metadata: {
            provider,
            providerId: userInfo.id,
            name: userInfo.name,
            picture: userInfo.picture,
          },
        })
        .returning();
      user = newUser;
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return user;
  }

  async storeTokens(
    userId: string,
    provider: string,
    tokenResponse: OAuth2TokenResponse,
  ): Promise<OAuthToken> {
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    const accessResult = await this.encryptionService.encrypt(tokenResponse.access_token, userId);

    let refreshTokenEncrypted: string | null = null;
    let refreshTokenIv: string | null = null;
    let refreshTokenAuthTag: string | null = null;

    if (tokenResponse.refresh_token) {
      const refreshResult = await this.encryptionService.encrypt(tokenResponse.refresh_token, userId);
      refreshTokenEncrypted = refreshResult.encrypted;
      refreshTokenIv = refreshResult.iv;
      refreshTokenAuthTag = refreshResult.authTag;
    } else {
      const existing = await db.query.oauthTokens.findFirst({
        where: and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)),
      });
      if (existing?.refreshTokenEncrypted && existing.refreshTokenAuthTag) {
        refreshTokenEncrypted = existing.refreshTokenEncrypted;
        refreshTokenIv = existing.refreshTokenIv;
        refreshTokenAuthTag = existing.refreshTokenAuthTag;
      }
    }

    let idTokenEncrypted: string | null = null;
    let idTokenIv: string | null = null;
    let idTokenAuthTag: string | null = null;

    if (tokenResponse.id_token) {
      const idResult = await this.encryptionService.encrypt(tokenResponse.id_token, userId);
      idTokenEncrypted = idResult.encrypted;
      idTokenIv = idResult.iv;
      idTokenAuthTag = idResult.authTag;
    }

    const newToken: NewOAuthToken = {
      userId,
      provider,
      accessTokenEncrypted: accessResult.encrypted,
      accessTokenIv: accessResult.iv,
      accessTokenAuthTag: accessResult.authTag,
      refreshTokenEncrypted,
      refreshTokenIv,
      refreshTokenAuthTag,
      tokenType: tokenResponse.token_type,
      expiresAt,
      scopes: tokenResponse.scope ? tokenResponse.scope.split(' ') : [],
      idTokenEncrypted,
      idTokenIv,
      idTokenAuthTag,
      metadata: {},
    };

    const [token] = await db
      .insert(oauthTokens)
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
      details: { provider, expiresAt, scopes: newToken.scopes },
    });

    return token;
  }

  async getValidToken(userId: string, provider: string, requiredScopes?: string[]): Promise<string> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)),
    });

    if (!token || token.revokedAt) {
      throw new Error(`No valid token found for user ${userId} with provider ${provider}`);
    }

    const now = new Date();
    const needsRefresh = token.expiresAt.getTime() - now.getTime() < this.tokenRefreshBufferMs;

    if (needsRefresh) {
      return this.refreshAccessToken(userId, provider);
    }

    const accessTokenAuthTag = token.accessTokenAuthTag
      || (token.metadata as Record<string, string> | null)?.accessTokenAuthTag
      || '';

    const accessToken = await this.encryptionService.decrypt(
      token.accessTokenEncrypted,
      token.accessTokenIv,
      accessTokenAuthTag,
      userId,
    );

    if (requiredScopes) {
      const hasAllScopes = requiredScopes.every(scope => token.scopes.includes(scope));
      if (!hasAllScopes) {
        throw new Error(
          `Token missing required scopes: ${requiredScopes.filter(s => !token.scopes.includes(s)).join(', ')}`,
        );
      }
    }

    await db
      .update(oauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthTokens.id, token.id));

    return accessToken;
  }

  async refreshAccessToken(userId: string, provider: string): Promise<string> {
    const lockKey = `${userId}:${provider}`;

    const existing = this.refreshLocks.get(lockKey);
    if (existing) return existing;

    const refreshPromise = this.doRefreshAccessToken(userId, provider);
    this.refreshLocks.set(lockKey, refreshPromise);

    try {
      const result = await refreshPromise;
      return result;
    } finally {
      this.refreshLocks.delete(lockKey);
    }
  }

  private async doRefreshAccessToken(userId: string, provider: string): Promise<string> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)),
    });

    if (!token?.refreshTokenEncrypted || token.revokedAt) {
      throw new Error(`No refresh token available for user ${userId} with provider ${provider}`);
    }

    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`OAuth provider '${provider}' not configured`);
    }

    const refreshTokenAuthTag = token.refreshTokenAuthTag
      || (token.metadata as Record<string, string> | null)?.refreshTokenAuthTag
      || '';

    const refreshToken = await this.encryptionService.decrypt(
      token.refreshTokenEncrypted,
      token.refreshTokenIv!,
      refreshTokenAuthTag,
      userId,
    );

    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      await db
        .update(oauthTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthTokens.id, token.id));

      await this.auditLogger.log({
        eventType: 'token_revoked',
        userId,
        action: 'refresh_failed',
        resource: `oauth:${provider}`,
        outcome: 'failure',
        details: { provider, reason: 'refresh_token_invalid' },
      });

      throw new Error(`Token refresh failed: HTTP ${response.status}`);
    }

    const tokenResponse = (await response.json()) as OAuth2TokenResponse;
    const newToken = await this.storeTokens(userId, provider, tokenResponse);

    await this.auditLogger.log({
      eventType: 'token_refresh',
      userId,
      action: 'token_refreshed',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider, newExpiresAt: newToken.expiresAt },
    });

    const newAccessTokenAuthTag = newToken.accessTokenAuthTag
      || (newToken.metadata as Record<string, string> | null)?.accessTokenAuthTag
      || '';

    const accessToken = await this.encryptionService.decrypt(
      newToken.accessTokenEncrypted,
      newToken.accessTokenIv,
      newAccessTokenAuthTag,
      userId,
    );

    return accessToken;
  }

  async revokeToken(userId: string, provider: string): Promise<void> {
    const token = await db.query.oauthTokens.findFirst({
      where: and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)),
    });

    if (!token) return;

    await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthTokens.id, token.id));

    await this.auditLogger.log({
      eventType: 'token_revoked',
      userId,
      action: 'token_revoked',
      resource: `oauth:${provider}`,
      outcome: 'success',
      details: { provider },
    });
  }

  private async storeCodeVerifier(
    state: string,
    codeVerifier: string,
    userId: string,
  ): Promise<void> {
    const encrypted = await this.encryptionService.encrypt(codeVerifier, userId);
    await db.insert(oauthStates).values({
      state,
      codeVerifier: `${encrypted.encrypted}:${encrypted.iv}:${encrypted.authTag}`,
      userId,
      expiresAt: new Date(Date.now() + 600 * 1000),
    });
  }

  private async retrieveCodeVerifier(
    state: string,
  ): Promise<{ codeVerifier: string; userId: string } | null> {
    const [record] = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning();

    if (!record || record.expiresAt < new Date()) {
      return null;
    }

    const parts = record.codeVerifier.split(':');
    if (parts.length !== 3) {
      throw new Error('Stored code verifier has unexpected format - encryption required');
    }
    const [encrypted, iv, authTag] = parts;
    const decrypted = await this.encryptionService.decrypt(encrypted, iv, authTag, record.userId);

    return { codeVerifier: decrypted, userId: record.userId };
  }


}
