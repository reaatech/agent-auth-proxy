# Skill: API Key Vault

## Overview

Creates secure API key storage with AES-256-GCM encryption and AWS KMS integration. API keys are user-specific and isolated — each user's keys are encrypted with a unique data encryption key (DEK) protected by a key encryption key (KEK) in KMS.

## Metadata

- **Name**: API Key Vault
- **Description**: Secure storage, rotation, and retrieval of per-user API keys with encryption at rest
- **Complexity**: Medium
- **Estimated Time**: 3 hours
- **Dependencies**: Project Scaffolding, Database Schema

## Inputs

```typescript
interface ApiKeyVaultInputs {
  kmsKeyArn?: string;           // AWS KMS key ARN for KEK
  masterKey?: string;           // Fallback: base64-encoded 256-bit key for non-AWS environments
  encryptionAlgorithm?: string; // Default: 'aes-256-gcm'
  keyRotationDays?: number;     // Default: 90
}
```

## Outputs

### Core Service

#### src/auth/managers/keyVault.ts

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { AuditLogger } from '@/services/auditService';

export interface EncryptedKey {
  encrypted: string;  // base64
  iv: Buffer;
  authTag: Buffer;
}

export class KeyVault {
  private masterKey: Buffer;
  private auditLogger: AuditLogger;

  constructor(config: ApiKeyVaultInputs) {
    // Derive KEK from master key or KMS
    const keyMaterial = config.kmsKeyArn
      ? this.fetchKmsKey(config.kmsKeyArn)
      : Buffer.from(config.masterKey!, 'base64');
    this.masterKey = scryptSync(keyMaterial, 'agent-auth-proxy-salt', 32);
    this.auditLogger = new AuditLogger();
  }

  async storeApiKey(
    userId: string,
    provider: string,
    plainKey: string
  ): Promise<void> {
    // Generate per-user DEK
    const dek = this.deriveDek(userId, provider);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    
    let encrypted = cipher.update(plainKey, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    // Hash for verification without decryption
    const keyHash = await this.hashKey(plainKey);
    const keyPrefix = plainKey.slice(0, 8);

    await db.insert(apiKeys).values({
      userId,
      provider,
      keyEncrypted: encrypted,
      keyIv: iv,
      keyHash,
      keyPrefix,
    }).onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: {
        keyEncrypted: encrypted,
        keyIv: iv,
        keyHash,
        keyPrefix,
        updatedAt: new Date(),
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

    const dek = this.deriveDek(userId, provider);
    const decipher = createDecipheriv('aes-256-gcm', dek, key.keyIv);
    decipher.setAuthTag(key.authTag as unknown as Buffer); // authTag stored with encrypted data

    let decrypted = decipher.update(key.keyEncrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    // Update last used
    await db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, key.id));

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

  private deriveDek(userId: string, provider: string): Buffer {
    return scryptSync(this.masterKey, `${userId}:${provider}`, 32);
  }

  private async hashKey(key: string): Promise<string> {
    // Use Node.js crypto for SHA-256 hash
    const { createHash } = await import('crypto');
    return createHash('sha256').update(key).digest('hex');
  }

  private fetchKmsKey(arn: string): Buffer {
    // TODO: Implement AWS KMS Decrypt call
    // For now, throw if KMS is requested but not available
    throw new Error('AWS KMS integration not yet implemented. Use masterKey fallback.');
  }
}
```

### Storage Schema

Uses the `api_keys` table defined in Database Schema skill:
- `key_encrypted`: AES-256-GCM ciphertext (base64)
- `key_iv`: 16-byte initialization vector
- `key_hash`: SHA-256 of plaintext for integrity verification
- `key_prefix`: First 8 chars for UI display (e.g., `sk-abc12...`)

## Validation

After running this skill, verify:
- [ ] API keys are encrypted before database storage
- [ ] Decryption returns the exact original key
- [ ] Key hash matches plaintext hash
- [ ] Audit logs capture all key storage and access events
- [ ] Revoked keys cannot be retrieved
- [ ] Per-user key isolation is enforced

## Security Considerations

- Never log plaintext API keys
- Master key must be 32 bytes (256 bits) of cryptographically secure random data
- DEK is derived per `(userId, provider)` pair — keys for different users use different encryption keys
- Auth tag from AES-GCM must be stored alongside ciphertext (12 bytes, appended or separate column)
- Key rotation: generate new DEK and re-encrypt all keys on master key rotation

## Next Steps

After API key vault:
1. Proxy engine integration (attach API keys to requests)
2. Service account token management
3. Security hardening (key rotation automation)
