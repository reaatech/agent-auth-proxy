import { KeyVault } from '@/auth/managers/keyVault';
import { db } from '@/db';
import { apiKeys, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('KeyVault', () => {
  const vault = new KeyVault();
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await db
      .insert(users)
      .values({ id: userId, email: 'vault-test@example.com' })
      .onConflictDoNothing();
  });

  it('should store and retrieve an API key', async () => {
    const provider = 'test-provider';
    const key = 'sk-test-secret-key-12345';

    await vault.storeApiKey(userId, provider, key);
    const retrieved = await vault.getApiKey(userId, provider);

    expect(retrieved).toBe(key);
  });

  it('should update an existing key', async () => {
    const provider = 'test-provider';
    const newKey = 'sk-new-secret-key-67890';

    await vault.storeApiKey(userId, provider, newKey);
    const retrieved = await vault.getApiKey(userId, provider);

    expect(retrieved).toBe(newKey);
  });

  it('should throw for missing key', async () => {
    await expect(
      vault.getApiKey('00000000-0000-0000-0000-000000009999', 'nonexistent'),
    ).rejects.toThrow('No valid API key');
  });

  it('should handle key with missing authTag', async () => {
    const provider = 'authtag-test';
    const key = 'sk-authtag-key-12345';

    await vault.storeApiKey(userId, provider, key);

    // Clear the authTag column to test decryption failure
    await db.update(apiKeys).set({ keyAuthTag: null }).where(eq(apiKeys.userId, userId));

    // getApiKey will try to decrypt with empty authTag - AES-GCM will fail
    await expect(vault.getApiKey(userId, provider)).rejects.toThrow();
  });
});
