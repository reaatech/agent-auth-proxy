import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '@/db';
import { users, agents, userAgentGrants, oauthTokens } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getAuditLogger } from '@/services/auditService';
import { ScopeEnforcer } from '@/auth/managers/scopeManager';
import { createHash, randomBytes } from 'crypto';
import { requireAdmin } from '@/api/middleware/auth';
import { ValidationError } from '@/utils/errors';

const createUserSchema = z.object({
  email: z.string().email(),
});

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

const createGrantSchema = z.object({
  user_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  scopes: z.array(z.string()),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const uuidSchema = z.string().uuid();

export const managementRoutes: FastifyPluginAsync = async (fastify) => {
  const auditLogger = getAuditLogger();

  fastify.addHook('preValidation', requireAdmin);

  fastify.route({
    method: 'POST',
    url: '/users',
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }

      const [user] = await db.insert(users).values({ email: parsed.data.email }).returning();
      await auditLogger.log({
        eventType: 'configuration_change',
        action: 'user_created',
        resource: `user:${user.id}`,
        outcome: 'success',
      });
      reply.code(201).send(user);
    },
  });

  fastify.get('/users/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid user ID format');
    }
    const user = await db.query.users.findFirst({ where: eq(users.id, parsed.data) });
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: 'User not found' });
    reply.send(user);
  });

  fastify.delete('/users/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid user ID format');
    }
    await db.delete(users).where(eq(users.id, parsed.data));
    await auditLogger.log({
      eventType: 'configuration_change',
      action: 'user_deleted',
      resource: `user:${parsed.data}`,
      outcome: 'success',
    });
    reply.code(204).send();
  });

  fastify.get('/users/:id/grants', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid user ID format');
    }
    const grants = await db.query.userAgentGrants.findMany({
      where: eq(userAgentGrants.userId, parsed.data),
    });
    reply.send(grants);
  });

  // Agents
  fastify.post('/agents', async (request, reply) => {
    const parsed = createAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const apiKey = `aap_${randomBytes(32).toString('base64url')}`;
    const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');

    const [agent] = await db
      .insert(agents)
      .values({
        name: parsed.data.name,
        description: parsed.data.description,
        apiKeyHash,
        apiKeyPrefix: apiKey.slice(0, 8),
      })
      .returning();

    await auditLogger.log({
      eventType: 'configuration_change',
      action: 'agent_created',
      resource: `agent:${agent.id}`,
      outcome: 'success',
    });

    reply.code(201).send({ ...agent, api_key: apiKey });
  });

  fastify.get('/agents/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid agent ID format');
    }
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, parsed.data),
      columns: {
        id: true,
        name: true,
        description: true,
        apiKeyPrefix: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    });
    if (!agent) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Agent not found' });
    reply.send(agent);
  });

  fastify.delete('/agents/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid agent ID format');
    }
    await db.delete(agents).where(eq(agents.id, parsed.data));
    await auditLogger.log({
      eventType: 'configuration_change',
      action: 'agent_deleted',
      resource: `agent:${parsed.data}`,
      outcome: 'success',
    });
    reply.code(204).send();
  });

  // Grants
  fastify.post('/grants', async (request, reply) => {
    const parsed = createGrantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const [grant] = await db
      .insert(userAgentGrants)
      .values({
        userId: parsed.data.user_id,
        agentId: parsed.data.agent_id,
        scopes: parsed.data.scopes,
      })
      .returning();

    await auditLogger.log({
      eventType: 'grant_created',
      userId: parsed.data.user_id,
      agentId: parsed.data.agent_id,
      action: 'grant_created',
      resource: `grant:${grant.id}`,
      outcome: 'success',
      details: { scopes: parsed.data.scopes },
    });

    reply.code(201).send(grant);
  });

  fastify.get('/grants', async (request, reply) => {
    const parsed = paginationSchema.safeParse(request.query);
    const { limit, offset } = parsed.success ? parsed.data : { limit: 50, offset: 0 };
    const allGrants = await db.query.userAgentGrants.findMany({
      orderBy: desc(userAgentGrants.grantedAt),
      limit,
      offset,
    });
    reply.send(allGrants);
  });

  fastify.delete('/grants/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid grant ID format');
    }

    const grant = await db.query.userAgentGrants.findFirst({
      where: eq(userAgentGrants.id, parsed.data),
    });

    await db
      .update(userAgentGrants)
      .set({ revokedAt: new Date(), revokedReason: 'admin_revoked' })
      .where(eq(userAgentGrants.id, parsed.data));

    if (grant) {
      const scopeEnforcer = new ScopeEnforcer();
      scopeEnforcer.invalidateCache(grant.userId, grant.agentId);
    }

    await auditLogger.log({
      eventType: 'grant_revoked',
      action: 'grant_revoked',
      resource: `grant:${parsed.data}`,
      outcome: 'success',
    });

    reply.code(204).send();
  });

  // Tokens (metadata only)
  fastify.get('/tokens', async (request, reply) => {
    const parsed = paginationSchema.safeParse(request.query);
    const { limit, offset } = parsed.success ? parsed.data : { limit: 50, offset: 0 };
    const tokens = await db.query.oauthTokens.findMany({
      columns: {
        id: true,
        userId: true,
        provider: true,
        scopes: true,
        expiresAt: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: desc(oauthTokens.createdAt),
      limit,
      offset,
    });
    reply.send(tokens);
  });

  fastify.delete('/tokens/:id', async (request, reply) => {
    const parsed = uuidSchema.safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      throw new ValidationError('Invalid token ID format');
    }
    await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.id, parsed.data));
    await auditLogger.log({
      eventType: 'token_revoked',
      action: 'token_revoked',
      resource: `token:${parsed.data}`,
      outcome: 'success',
    });
    reply.code(204).send();
  });
};
