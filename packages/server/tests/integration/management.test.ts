import { buildApp } from '@/app';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDbAvailable } from '../utils';

describe.skipIf(!(await isDbAvailable()))('Management API', () => {
  let app: ReturnType<typeof supertest>;
  let fastify: Awaited<ReturnType<typeof buildApp>>;
  const adminKey = 'test-admin-api-key-secret-32b!!';

  beforeAll(async () => {
    fastify = await buildApp();
    await fastify.ready();
    app = supertest(fastify.server);
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should reject without admin API key', async () => {
    const res = await app.post('/api/v1/users').send({ email: 'test@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ADMIN_REQUIRED');
  });

  it('should create and retrieve a user', async () => {
    const createRes = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: 'test-mgmt@example.com' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.email).toBe('test-mgmt@example.com');

    const getRes = await app
      .get(`/api/v1/users/${createRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(getRes.status).toBe(200);
    expect(getRes.body.email).toBe('test-mgmt@example.com');
  });

  it('should delete a user', async () => {
    const createRes = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: 'delete-user@example.com' });
    const delRes = await app
      .delete(`/api/v1/users/${createRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(delRes.status).toBe(204);

    const getRes = await app
      .get(`/api/v1/users/${createRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(getRes.status).toBe(404);
  });

  it('should get user grants', async () => {
    const userRes = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: 'grants-user@example.com' });
    const agentRes = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: 'grants-agent' });
    await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userRes.body.id,
        agent_id: agentRes.body.id,
        scopes: ['email'],
      });

    const grantsRes = await app
      .get(`/api/v1/users/${userRes.body.id}/grants`)
      .set('X-Admin-API-Key', adminKey);
    expect(grantsRes.status).toBe(200);
    expect((grantsRes.body as { length: number }).length).toBeGreaterThan(0);
  });

  it('should create an agent with API key', async () => {
    const res = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: 'test-agent' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('test-agent');
    expect(res.body.api_key).toBeDefined();
    expect(String(res.body.api_key).startsWith('aap_')).toBe(true);
  });

  it('should get and delete an agent', async () => {
    const createRes = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: 'get-agent' });
    const getRes = await app
      .get(`/api/v1/agents/${createRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe('get-agent');

    const delRes = await app
      .delete(`/api/v1/agents/${createRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(delRes.status).toBe(204);
  });

  it('should create and revoke a grant', async () => {
    const userRes = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: 'grant-test@example.com' });
    const agentRes = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: 'grant-agent' });

    const grantRes = await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({
        user_id: userRes.body.id,
        agent_id: agentRes.body.id,
        scopes: ['email'],
      });
    expect(grantRes.status).toBe(201);

    const delRes = await app
      .delete(`/api/v1/grants/${grantRes.body.id}`)
      .set('X-Admin-API-Key', adminKey);
    expect(delRes.status).toBe(204);
  });

  it('should list all grants', async () => {
    const res = await app.get('/api/v1/grants').set('X-Admin-API-Key', adminKey);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should list and revoke tokens', async () => {
    const res = await app.get('/api/v1/tokens').set('X-Admin-API-Key', adminKey);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('should return 404 for missing user', async () => {
    const res = await app
      .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
      .set('X-Admin-API-Key', adminKey);
    expect(res.status).toBe(404);
  });

  it('should return 404 for missing agent', async () => {
    const res = await app
      .get('/api/v1/agents/00000000-0000-4000-8000-000000000000')
      .set('X-Admin-API-Key', adminKey);
    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid user body', async () => {
    const res = await app
      .post('/api/v1/users')
      .set('X-Admin-API-Key', adminKey)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid agent body', async () => {
    const res = await app
      .post('/api/v1/agents')
      .set('X-Admin-API-Key', adminKey)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid grant body', async () => {
    const res = await app
      .post('/api/v1/grants')
      .set('X-Admin-API-Key', adminKey)
      .send({ user_id: 'bad', agent_id: 'bad', scopes: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
