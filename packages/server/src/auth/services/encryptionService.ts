import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { config } from '@/config';
import { validateBase64Key } from '@/utils/crypto';

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
}

const DEK_CACHE = new Map<string, { dek: Buffer; expiresAt: number }>();
const DEK_CACHE_TTL_MS = 300_000;

export class EncryptionService {
  private masterKey: Buffer;

  constructor() {
    const keyMaterial = validateBase64Key(config.masterKey, 'MASTER_KEY');
    if (keyMaterial.length !== 32) {
      throw new Error('MASTER_KEY must be 32 bytes when base64-decoded');
    }
    this.masterKey = keyMaterial;
  }

  private async deriveKey(userId: string): Promise<Buffer> {
    const cacheKey = userId;
    const cached = DEK_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.dek;
    }

    const salt = createHash('sha256').update(`oauth:${userId}`).digest();
    const dek = await new Promise<Buffer>((resolve, reject) => {
      scrypt(this.masterKey, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });

    DEK_CACHE.set(cacheKey, { dek, expiresAt: Date.now() + DEK_CACHE_TTL_MS });
    return dek;
  }

  async encrypt(plaintext: string, userId: string): Promise<EncryptedData> {
    const key = await this.deriveKey(userId);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  }

  async decrypt(encrypted: string, iv: string, authTag: string, userId: string): Promise<string> {
    const key = await this.deriveKey(userId);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
