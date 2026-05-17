import { describe, expect, it } from 'vitest';
import { EncryptionService } from '@/auth/services/encryptionService';

describe('EncryptionService', () => {
  it('should encrypt and decrypt data correctly', async () => {
    const service = new EncryptionService();
    const plain = 'hello world';
    const { encrypted, iv, authTag } = await service.encrypt(plain);
    const decrypted = await service.decrypt(encrypted, iv, authTag);
    expect(decrypted).toBe(plain);
  });

  it('should produce different ciphertexts for same plaintext', async () => {
    const service = new EncryptionService();
    const plain = 'hello world';
    const cipher1 = await service.encrypt(plain);
    const cipher2 = await service.encrypt(plain);
    expect(cipher1.encrypted).not.toBe(cipher2.encrypted);
    expect(cipher1.iv).not.toBe(cipher2.iv);
  });

  it('should fail decryption with wrong IV', async () => {
    const service = new EncryptionService();
    const { encrypted, authTag } = await service.encrypt('hello');
    const wrongIv = Buffer.from('wrong-iv-16-byte').toString('base64');
    await expect(service.decrypt(encrypted, wrongIv, authTag)).rejects.toThrow();
  });
});
