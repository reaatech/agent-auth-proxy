/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proxyRequestSchema, oauthInitiateSchema } from '@/api/middleware/validation';
import { authenticateAgent, requireAdmin, authenticateAgentWithApiKey } from '@/api/middleware/auth';

describe('Validation schemas', () => {
  it('should validate proxy request', () => {
    const valid = {
      provider: 'google',
      path: '/v1/calendars',
      userId: '00000000-0000-0000-0000-000000000001',
      agentId: '00000000-0000-0000-0000-000000000002',
    };
    expect(proxyRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('should reject invalid provider', () => {
    const invalid = {
      provider: 'Google!',
      path: '/v1/calendars',
      userId: '00000000-0000-0000-0000-000000000001',
      agentId: '00000000-0000-0000-0000-000000000002',
    };
    expect(proxyRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('should reject invalid UUID', () => {
    const invalid = {
      provider: 'google',
      path: '/v1/calendars',
      userId: 'not-a-uuid',
      agentId: '00000000-0000-0000-0000-000000000002',
    };
    expect(proxyRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('should validate OAuth initiate', () => {
    const valid = {
      user_id: '00000000-0000-0000-0000-000000000001',
      provider: 'google',
      scopes: 'email,profile',
    };
    expect(oauthInitiateSchema.safeParse(valid).success).toBe(true);
  });

  it('should reject OAuth initiate with invalid user_id', () => {
    const invalid = {
      user_id: 'bad-id',
      provider: 'google',
      scopes: 'email',
    };
    expect(oauthInitiateSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('authenticateAgent', () => {
  const createMockReply = () => {
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    return reply as unknown as import('fastify').FastifyReply;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when jwtVerify throws non-Error', async () => {
    const request = {
      jwtVerify: vi.fn().mockRejectedValue('string-error'),
    } as unknown as import('fastify').FastifyRequest;
    const reply = createMockReply();

    await authenticateAgent(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Authentication required' }),
    );
  });

  it('should return 401 when JWT payload missing agentId', async () => {
    const request = {
      jwtVerify: vi.fn().mockResolvedValue(undefined),
      user: { name: 'test' },
    } as unknown as import('fastify').FastifyRequest;
    const reply = createMockReply();

    await authenticateAgent(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'AUTH_REQUIRED' }),
    );
  });
});

describe('requireAdmin', () => {
  it('should return 403 when admin key is missing', async () => {
    const request = {
      headers: {},
    } as unknown as import('fastify').FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as import('fastify').FastifyReply;

    await requireAdmin(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'ADMIN_REQUIRED' }),
    );
  });
});

describe('authenticateAgentWithApiKey', () => {
  it('should return 401 when authorization header missing', async () => {
    const request = {
      headers: {},
    } as unknown as import('fastify').FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as import('fastify').FastifyReply;

    await authenticateAgentWithApiKey(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_API_KEY' }),
    );
  });

  it('should return 401 when apiKey does not start with aap_', async () => {
    const request = {
      headers: { authorization: 'Bearer not-aap-key' },
    } as unknown as import('fastify').FastifyRequest;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as import('fastify').FastifyReply;

    await authenticateAgentWithApiKey(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'INVALID_API_KEY' }),
    );
  });
});
