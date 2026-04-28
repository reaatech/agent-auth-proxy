# Skill: Security Hardening

## Overview

Applies security best practices including encryption, rate limiting, input validation, secure headers, and anomaly detection. This skill hardens the proxy against common attack vectors: credential leakage, scope escalation, DoS, injection, and credential stuffing.

## Metadata

- **Name**: Security Hardening
- **Description**: Defense-in-depth security controls for the proxy and management APIs
- **Complexity**: High
- **Estimated Time**: 3 hours
- **Dependencies**: Project Scaffolding, Database Schema, OAuth2 Integration, Proxy Engine

## Inputs

```typescript
interface SecurityHardeningInputs {
  rateLimits?: {
    global: { windowMs: number; max: number };
    perUser: { windowMs: number; max: number };
    perAgent: { windowMs: number; max: number };
    tokenRefresh: { windowMs: number; max: number };
    oauthInitiate: { windowMs: number; max: number };
  };
  maxRequestBodySize?: string;      // Default: '10mb'
  maxResponseBodySize?: string;     // Default: '50mb'
  enableHelmet?: boolean;           // Default: true
  allowedHosts?: string[];          // Host header validation
  blockCommonAttacks?: boolean;     // Default: true
}
```

## Outputs

### Rate Limiting (Atomic, Redis-backed)

```typescript
import { Redis } from 'ioredis';

export class RateLimiter {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async check(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number }> {
    const windowKey = `${key}:${Math.floor(Date.now() / windowMs)}`;
    
    const pipeline = this.redis.pipeline();
    pipeline.incr(windowKey);
    pipeline.pexpire(windowKey, windowMs);
    
    const results = await pipeline.exec();
    const count = (results?.[0]?.[1] as number) || 1;
    
    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
    };
  }
}
```

### Secure Headers (Helmet + Custom)

```typescript
import helmet from '@fastify/helmet';

export async function registerSecurityHeaders(fastify: FastifyInstance) {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Admin dashboard only
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // Custom security headers
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    return payload;
  });
}
```

### Input Validation

```typescript
import { z } from 'zod';

export const proxyRequestSchema = z.object({
  provider: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  path: z.string().max(2048).regex(/^[\w\-/.?&=]+$/),
  userId: z.string().uuid(),
  agentId: z.string().uuid(),
  scopes: z.string().max(512).optional(),
});

export const oauthInitiateSchema = z.object({
  user_id: z.string().uuid(),
  provider: z.string().min(1).max(100),
  scopes: z.string().max(512),
});
```

### Anomaly Detection

```typescript
export class AnomalyDetector {
  private redis: Redis;

  async check(userId: string, agentId: string, event: string): Promise<boolean> {
    // Track event frequency in sliding windows
    const key = `anomaly:${userId}:${agentId}:${event}`;
    const count = await this.redis.incr(key);
    await this.redis.expire(key, 3600);

    // Alert on unusual patterns
    if (count > 100) {
      // Log security event for review
      return false; // Block
    }
    return true;
  }
}
```

## Validation

After running this skill, verify:
- [ ] Rate limits enforce per-IP, per-user, per-agent boundaries
- [ ] OAuth endpoints have stricter rate limits than proxy endpoints
- [ ] Helmet headers are present on all responses
- [ ] Invalid `provider` names are rejected (alphanumeric + hyphen only)
- [ ] Request body size limits are enforced
- [ ] SQL injection attempts are blocked by Drizzle parameterized queries
- [ ] Anomaly detector flags unusual traffic patterns

## Security Considerations

- Rate limit keys must include the IP address to prevent distributed attacks
- Redis must be configured with AUTH and TLS in production
- Input validation schemas must be strict — reject unexpected fields
- The proxy must not forward the `Host` header to downstream APIs
- Consider adding IP allowlisting for management API access

## Next Steps

After security hardening:
1. Penetration testing scenarios
2. Security monitoring and alerting rules
3. Automated dependency vulnerability scanning
