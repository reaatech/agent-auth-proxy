import { z } from 'zod';

export const proxyParamsSchema = z.object({
  provider: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  path: z.string().min(1).max(2048),
});

export const proxyRequestSchema = z.object({
  provider: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  path: z.string().max(2048),
  userId: z.string().uuid(),
  agentId: z.string().uuid(),
  scopes: z.string().max(512).optional(),
});

export const oauthInitiateSchema = z.object({
  user_id: z.string().uuid(),
  provider: z.string().min(1).max(100),
  scopes: z.string().max(512),
});
