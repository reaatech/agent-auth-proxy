import { describe, it, expect, vi } from 'vitest';

describe('Config validation', () => {
  it('should load test config with defaults', async () => {
    const { config } = await import('@/config');
    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(3000);
    expect(config.masterKey).toBeDefined();
    expect(config.agentJwtSecret).toBeDefined();
    expect(config.databaseUrl).toBeDefined();
  });

  it('should use DATABASE_URL when set', async () => {
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://custom:custom@localhost:5432/custom';

    vi.resetModules();
    const { config } = await import('@/config');
    expect(config.databaseUrl).toBe('postgresql://custom:custom@localhost:5432/custom');

    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.resetModules();
  });

  it('should require masterKey without fallback in non-test env', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMasterKey = process.env.MASTER_KEY;
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.MASTER_KEY;
    process.env.DATABASE_URL = 'postgresql://prod:prod@localhost:5432/prod';

    vi.resetModules();
    await expect(import('@/config')).rejects.toThrow();

    process.env.NODE_ENV = originalNodeEnv;
    if (originalMasterKey !== undefined) {
      process.env.MASTER_KEY = originalMasterKey;
    }
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.resetModules();
  });
});
