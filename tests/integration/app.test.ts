import { describe, it, expect } from 'vitest';
import { buildApp } from '@/app';
import { config } from '@/config';
import { register } from 'prom-client';
import supertest from 'supertest';

describe('App', () => {
  it('should build without errors', async () => {
    const fastify = await buildApp();
    await fastify.ready();
    await fastify.close();
    expect(true).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    const fastify = await buildApp();
    await fastify.ready();
    const app = supertest(fastify.server);

    // Trigger a 404 which exercises the error handler
    const res = await app.get('/nonexistent');
    expect(res.status).toBe(404);

    await fastify.close();
  });

  it('should suppress 500 details in production', async () => {
    // Clear prom-client registry to allow rebuild
    register.clear();

    const originalNodeEnv = config.nodeEnv;
    (config as Record<string, string>).nodeEnv = 'production';

    const fastify = await buildApp();

    // Register a route that throws a 500 BEFORE ready()
    fastify.get('/test-500', async () => {
      const err = new Error('Secret database password: xyz123') as Error & { statusCode?: number };
      err.statusCode = 500;
      throw err;
    });

    await fastify.ready();

    const app = supertest(fastify.server);
    const res = await app.get('/test-500');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Internal server error');
    expect(res.body.message).not.toContain('Secret');

    await fastify.close();
    (config as Record<string, string>).nodeEnv = originalNodeEnv;
  });
});
