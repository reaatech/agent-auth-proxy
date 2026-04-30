import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '@/config';
import { db } from '@/db';
import { agents } from '@/db/schema';
import { AuthError } from '@reaatech/agent-auth-proxy-core';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

export async function authenticateAgent(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const payload = request.user as { agentId: string; name: string } | undefined;
    if (!payload?.agentId) {
      throw new AuthError('INVALID_TOKEN', 'Invalid agent token');
    }
    request.agent = {
      id: payload.agentId,
      name: payload.name || '',
    };
  } catch {
    reply.code(401).send({
      error: 'AUTH_REQUIRED',
      message: 'Authentication required',
    });
    return;
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const adminKey = request.headers['x-admin-api-key'] as string;
  if (!adminKey) {
    reply.code(403).send({
      error: 'ADMIN_REQUIRED',
      message: 'Valid admin API key required',
    });
    return;
  }

  const keyBuf = Buffer.from(adminKey);
  const expectedBuf = Buffer.from(config.adminApiKey);
  if (keyBuf.length !== expectedBuf.length || !timingSafeEqual(keyBuf, expectedBuf)) {
    reply.code(403).send({
      error: 'ADMIN_REQUIRED',
      message: 'Valid admin API key required',
    });
    return;
  }
}

export async function authenticateAgentWithApiKey(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization || '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!apiKey || !apiKey.startsWith('aap_')) {
    reply.code(401).send({
      error: 'INVALID_API_KEY',
      message: 'Valid agent API key required (Bearer aap_...)',
    });
    return;
  }

  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex');
  const agent = await db.query.agents.findFirst({
    where: eq(agents.apiKeyHash, apiKeyHash),
  });

  if (!agent || !agent.active) {
    reply.code(401).send({
      error: 'INVALID_API_KEY',
      message: 'Agent not found or inactive',
    });
    return;
  }

  request.agent = {
    id: agent.id,
    name: agent.name,
  };
}
