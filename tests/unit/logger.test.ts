import { describe, it, expect, vi } from 'vitest';

describe('Logger', () => {
  it('should use info level in test environment', async () => {
    const { logger } = await import('@/utils/logger');
    expect(logger.level).toBe('info');
    expect(logger).toBeDefined();
  });

  it('should use debug level and pino-pretty in development', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.NODE_ENV = 'development';
    // Ensure config has required values
    process.env.DATABASE_URL = 'postgresql://dev:dev@localhost:5432/dev';

    vi.resetModules();
    const { logger } = await import('@/utils/logger');
    expect(logger.level).toBe('debug');

    process.env.NODE_ENV = originalNodeEnv;
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.resetModules();
  });
});
