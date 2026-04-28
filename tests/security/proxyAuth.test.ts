import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '@/app';
import supertest from 'supertest';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { createHash } from 'crypto';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('Security: Proxy Authentication', () => {
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

  it('should reject proxy requests without Authorization header', async () => {
    const res = await app.get('/proxy/google/test');
    expect(res.status).toBe(401);
  });

  it('should reject proxy requests with invalid JWT', async () => {
    const res = await app.get('/proxy/google/test').set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  it('should reject proxy requests with revoked agent', async () => {
    const apiKey = 'aap_revokedagent123456';
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
    await db.insert(agents).values({
      name: 'revoked-agent',
      apiKeyHash,
      apiKeyPrefix: 'aap_revo',
      active: false,
    });

    const res = await app.post('/auth/agent').set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(401);
  });

  it('should reject management requests without admin API key', async () => {
    const res = await app.post('/api/v1/users').send({ email: 'test@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ADMIN_REQUIRED');
  });

  it('should reject management requests with invalid admin API key', async () => {
    const res = await app.post('/api/v1/users')
      .set('X-Admin-API-Key', 'wrong-key')
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ADMIN_REQUIRED');
  });
});
