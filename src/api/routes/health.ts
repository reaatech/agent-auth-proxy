import { FastifyPluginAsync } from 'fastify';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { register } from 'prom-client';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: 'ready', database: 'connected' };
    } catch {
      reply.code(503);
      return { status: 'not_ready', database: 'disconnected' };
    }
  });

  fastify.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
};
