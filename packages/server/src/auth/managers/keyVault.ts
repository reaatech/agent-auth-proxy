import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { config } from '@/config';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { type AuditLogger, getAuditLogger } from '@/services/auditService';
import { validateBase64Key } from '@/utils/crypto';

const DEK_CACHE = new Map<string, { dek: Buffer; expiresAt: number }>();
const DEK_CACHE_TTL_MS = 300_000;

export class KeyVault {
  private masterKey: Buffer;
  private auditLogger: AuditLogger;

  constructor() {
    const keyMaterial = validateBase64Key(config.masterKey, 'MASTER_KEY');
    if (keyMaterial.length !== 32) {
      throw new Error('MASTER_KEY must be 32 bytes when base64-decoded');
    }
    this.masterKey = keyMaterial;
    this.auditLogger = getAuditLogger();
  }

  async storeApiKey(userId: string, provider: string, plainKey: string): Promise<void> {
    const dek = await this.deriveDek(userId, provider);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);

    let encrypted = cipher.update(plainKey, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    const keyHash = createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 8);

    await db
      .insert(apiKeys)
      .values({
        userId,
        provider,
        keyEncrypted: encrypted,
        keyIv: iv.toString('base64'),
        keyAuthTag: authTag.toString('base64'),
        keyHash,
        keyPrefix,
      })
      .onConflictDoUpdate({
        target: [apiKeys.userId, apiKeys.provider],
        set: {
          keyEncrypted: encrypted,
          keyIv: iv.toString('base64'),
          keyAuthTag: authTag.toString('base64'),
          keyHash,
          keyPrefix,
          revokedAt: null,
        },
      });

    await this.auditLogger.log({
      eventType: 'configuration_change',
      userId,
      action: 'api_key_stored',
      resource: `api_key:${provider}`,
      outcome: 'success',
      details: { provider, keyPrefix },
    });
  }

  async getApiKey(userId: string, provider: string): Promise<string> {
    const key = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)),
    });

    if (!key || key.revokedAt) {
      throw new Error(`No valid API key for user ${userId} and provider ${provider}`);
    }

    const authTag =
      key.keyAuthTag || (key.metadata as Record<string, string> | null)?.authTag || '';

    const dek = await this.deriveDek(userId, provider);
    const decipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(key.keyIv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(key.keyEncrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

    await this.auditLogger.log({
      eventType: 'api_call',
      userId,
      action: 'api_key_accessed',
      resource: `api_key:${provider}`,
      outcome: 'success',
      details: { provider, keyPrefix: key.keyPrefix },
    });

    return decrypted;
  }

  private async deriveDek(userId: string, provider: string): Promise<Buffer> {
    const cacheKey = `${userId}:${provider}`;
    const cached = DEK_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.dek;
    }

    const salt = createHash('sha256').update(`${userId}:${provider}`).digest();
    const dek = await new Promise<Buffer>((resolve, reject) => {
      scrypt(this.masterKey, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });

    DEK_CACHE.set(cacheKey, { dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS });
    return dek;
  }
}
