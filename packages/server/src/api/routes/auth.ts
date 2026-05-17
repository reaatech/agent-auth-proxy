import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateAgentWithApiKey } from '@/api/middleware/auth';
import { getOAuth2Manager } from '@/auth/managers/shared';

const authorizeQuerySchema = z.object({
  user_id: z.string().uuid(),
  provider: z.string().min(1).max(100),
  scopes: z
    .string()
    .max(512)
    .refine((s) => s.split(',').length <= 20, 'Maximum of 20 scopes allowed'),
});

const callbackParamsSchema = z.object({
  provider: z.string().min(1).max(100),
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const oauth2Manager = getOAuth2Manager();

  // Agent authentication - exchange API key for JWT
  fastify.route({
    method: 'POST',
    url: '/auth/agent',
    preHandler: authenticateAgentWithApiKey,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      if (!request.agent) {
        return reply
          .code(401)
          .send({ error: 'AUTH_FAILED', message: 'Agent authentication failed' });
      }
      const token = await reply.jwtSign({
        agentId: request.agent.id,
        name: request.agent.name,
      });
      reply.send({ token, agent: { id: request.agent.id, name: request.agent.name } });
    },
  });

  // Initiate OAuth flow
  fastify.get('/oauth/authorize', async (request, reply) => {
    const parsed = authorizeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.message });
    }

    const { user_id, provider, scopes } = parsed.data;

    try {
      const { authorizationUrl } = await oauth2Manager.initiateAuthorization(
        user_id,
        provider,
        scopes.split(','),
      );
      reply.redirect(authorizationUrl);
    } catch (err) {
      reply.code(400).send({
        error: 'OAUTH_INITIATE_FAILED',
        message: (err as Error).message,
      });
    }
  });

  // OAuth callback
  fastify.get('/oauth/:provider/callback', async (request, reply) => {
    const paramsParsed = callbackParamsSchema.safeParse(request.params);
    const queryParsed = callbackQuerySchema.safeParse(request.query);

    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Invalid parameters' });
    }

    const { provider } = paramsParsed.data;
    const { code, state, error } = queryParsed.data;

    if (error) {
      return reply.code(400).send({ error: 'OAUTH_ERROR', message: error });
    }

    if (!state || !code) {
      return reply.code(400).send({ error: 'INVALID_CALLBACK', message: 'Missing state or code' });
    }

    try {
      const token = await oauth2Manager.handleCallback(code, state, provider);
      reply.send({ success: true, token_id: token.id });
    } catch (err) {
      reply.code(400).send({
        error: 'TOKEN_EXCHANGE_FAILED',
        message: (err as Error).message,
      });
    }
  });
};
