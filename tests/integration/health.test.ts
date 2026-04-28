import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '@/app';
import supertest from 'supertest';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('Health Endpoints', () => {
  let app: ReturnType<typeof supertest>;
  let fastify: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    fastify = await buildApp();
    await fastify.ready();
    app = supertest(fastify.server);
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should return health status', async () => {
    const res = await app.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('should return readiness status', async () => {
    const res = await app.get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
  });

  it('should return metrics', async () => {
    const res = await app.get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('# HELP');
  });

  it('should hit proxy route to cover onResponse hook route fallback', async () => {
    // This exercises the onResponse hook with a proxy route
    const res = await app.get('/proxy/google/test');
    // Will be 401 (no auth), but the hook still fires
    expect(res.status).toBe(401);
  });
});
