# Skill: Proxy Engine

## Overview

Builds the core proxy functionality including request interception, credential attachment, and response forwarding. The proxy preserves HTTP methods, supports streaming, and handles automatic token refresh on 401 responses from downstream APIs.

## Metadata

- **Name**: Proxy Engine
- **Description**: Core request proxying with credential injection, scope validation, and streaming support
- **Complexity**: High
- **Estimated Time**: 4 hours
- **Dependencies**: Project Scaffolding, Database Schema, OAuth2 Integration, API Key Vault, Scope Enforcement

## Inputs

```typescript
interface ProxyEngineInputs {
  downstreamTimeoutMs?: number;     // Default: 30000
  maxRequestBodySize?: string;      // Default: '10mb'
  maxResponseBodySize?: string;     // Default: '50mb'
  enableStreaming?: boolean;        // Default: true
  retryAttempts?: number;           // Default: 1 (no retry for mutations)
  circuitBreakerThreshold?: number; // Default: 5 failures
  allowedDownstreamHeaders?: string[]; // Headers to forward from downstream
  strippedDownstreamHeaders?: string[]; // Headers to strip (security)
}
```

## Outputs

### Core Proxy Service

#### src/proxy/engine.ts

```typescript
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { OAuth2Manager } from '@/auth/managers/oauth2Manager';
import { KeyVault } from '@/auth/managers/keyVault';
import { ScopeEnforcer } from '@/auth/managers/scopeManager';
import { AuditLogger } from '@/services/auditService';

interface ProxyParams {
  provider: string;
  '*': string;  // catch-all path
}

interface ProxyQuery {
  '_scope'?: string;  // optional scope override for validation
}

export const proxyRoutes: FastifyPluginAsync = async (fastify) => {
  const oauth2Manager = new OAuth2Manager(fastify.config.oauth2);
  const keyVault = new KeyVault(fastify.config.keyVault);
  const scopeEnforcer = new ScopeEnforcer();
  const auditLogger = new AuditLogger();

  // Support all HTTP methods
  fastify.all('/proxy/:provider/*', async (request: FastifyRequest<{
    Params: ProxyParams;
    Querystring: ProxyQuery;
  }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const provider = request.params.provider;
    const path = request.params['*'];
    const userId = request.headers['x-user-id'] as string;
    const agentId = (request as any).agent?.id; // set by auth middleware
    const requestedScopes = (request.query._scope || '').split(',').filter(Boolean);

    if (!userId) {
      return reply.code(400).send({ error: 'MISSING_USER_ID', message: 'X-User-ID header is required' });
    }

    try {
      // 1. Scope enforcement
      const scopeResult = await scopeEnforcer.validateRequest(userId, agentId, requestedScopes, provider);
      if (!scopeResult.allowed) {
        await auditLogger.log({
          eventType: 'scope_violation',
          userId,
          agentId,
          action: 'proxy_request',
          resource: `${provider}:${path}`,
          outcome: 'blocked',
          details: { reason: scopeResult.reason, requestedScopes },
        });
        return reply.code(403).send({
          error: scopeResult.reason,
          message: `Request blocked: ${scopeResult.reason}`,
          grantedScopes: scopeResult.grantedScopes,
          requestedScopes: scopeResult.requestedScopes,
        });
      }

      // 2. Select credential type and retrieve
      let credential: { type: 'bearer' | 'api_key' | 'basic'; value: string; headerName?: string };
      
      try {
        const token = await oauth2Manager.getValidToken(userId, provider, requestedScopes);
        credential = { type: 'bearer', value: token };
      } catch (oauthErr) {
        // Fallback to API key if no OAuth token
        try {
          const apiKey = await keyVault.getApiKey(userId, provider);
          credential = { type: 'api_key', value: apiKey, headerName: 'X-API-Key' };
        } catch (apiKeyErr) {
          return reply.code(401).send({
            error: 'NO_CREDENTIALS',
            message: `No valid credentials found for user ${userId} and provider ${provider}`,
          });
        }
      }

      // 3. Build downstream request
      const downstreamUrl = `${fastify.config.providers[provider].baseUrl}/${path}`;
      const downstreamHeaders: Record<string, string> = {
        ...Object.fromEntries(
          Object.entries(request.headers)
            .filter(([key]) => !['host', 'authorization', 'x-user-id', 'x-agent-id', 'content-length'].includes(key.toLowerCase()))
        ),
        'X-Forwarded-By': 'agent-auth-proxy',
        'X-Proxy-User-ID': userId,
      };

      if (credential.type === 'bearer') {
        downstreamHeaders['Authorization'] = `Bearer ${credential.value}`;
      } else if (credential.type === 'api_key' && credential.headerName) {
        downstreamHeaders[credential.headerName] = credential.value;
      }

      // 4. Execute request with streaming support
      const downstreamResponse = await fetch(downstreamUrl, {
        method: request.method,
        headers: downstreamHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body as BodyInit,
        // @ts-ignore — duplex needed for Node.js fetch streaming
        duplex: 'half',
      });

      // 5. Handle 401 from downstream (token expired — reactive refresh)
      if (downstreamResponse.status === 401 && credential.type === 'bearer') {
        const refreshedToken = await oauth2Manager.refreshAccessToken(userId, provider);
        downstreamHeaders['Authorization'] = `Bearer ${refreshedToken}`;
        
        const retryResponse = await fetch(downstreamUrl, {
          method: request.method,
          headers: downstreamHeaders,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body as BodyInit,
          duplex: 'half',
        });
        
        return forwardResponse(retryResponse, reply, startTime, userId, agentId, provider, path, auditLogger);
      }

      // 6. Forward response
      return forwardResponse(downstreamResponse, reply, startTime, userId, agentId, provider, path, auditLogger);

    } catch (error) {
      const duration = Date.now() - startTime;
      await auditLogger.log({
        eventType: 'api_call',
        userId,
        agentId,
        action: 'proxy_request',
        resource: `${provider}:${path}`,
        outcome: 'failure',
        details: { error: (error as Error).message, duration },
      });
      
      return reply.code(502).send({
        error: 'UPSTREAM_ERROR',
        message: (error as Error).message,
      });
    }
  });
};

async function forwardResponse(
  response: Response,
  reply: FastifyReply,
  startTime: number,
  userId: string,
  agentId: string,
  provider: string,
  path: string,
  auditLogger: AuditLogger
) {
  const duration = Date.now() - startTime;
  
  // Strip security-sensitive downstream headers
  const strippedHeaders = ['set-cookie', 'www-authenticate', 'x-amz-id-2', 'x-amz-request-id'];
  const safeHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!strippedHeaders.includes(key.toLowerCase())) {
      safeHeaders[key] = value;
    }
  });

  reply.code(response.status);
  Object.entries(safeHeaders).forEach(([key, value]) => {
    reply.header(key, value);
  });
  reply.header('X-Request-ID', crypto.randomUUID());
  reply.header('X-Duration-Ms', duration);

  // Handle streaming (SSE, chunked)
  if (response.body) {
    const contentType = response.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream') || 
                     response.headers.get('transfer-encoding') === 'chunked';
    
    if (isStream) {
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'no-cache');
      reply.header('Connection', 'keep-alive');
      
      const reader = response.body.getReader();
      reply.raw.on('close', () => reader.cancel());
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
      } finally {
        reply.raw.end();
      }
      
      await auditLogger.log({
        eventType: 'api_call',
        userId,
        agentId,
        action: 'proxy_stream',
        resource: `${provider}:${path}`,
        outcome: 'success',
        details: { provider, path, duration, streaming: true },
      });
      return;
    }
  }

  const body = await response.text();
  reply.send(body);

  await auditLogger.log({
    eventType: 'api_call',
    userId,
    agentId,
    action: 'proxy_request',
    resource: `${provider}:${path}`,
    outcome: 'success',
    statusCode: response.status,
    durationMs: duration,
    details: { provider, path, duration },
  });
}
```

## Validation

After running this skill, verify:
- [ ] GET/POST/PUT/PATCH/DELETE methods are preserved through the proxy
- [ ] OAuth Bearer tokens are attached to downstream requests
- [ ] API keys attach with correct header name per provider
- [ ] 401 from downstream triggers reactive token refresh
- [ ] Scope violations return 403 with reason code
- [ ] Streaming responses (SSE) pass through without buffering
- [ ] Security-sensitive headers are stripped from downstream
- [ ] Audit logs capture all proxy requests with duration

## Performance Considerations

- Use `duplex: 'half'` for Node.js 18+ fetch to support streaming request bodies
- Response bodies > 50MB should stream; smaller responses can be buffered for header mutation
- Connection pooling via `undici` or `http-agent` for repeated downstream calls
- Token cache in Redis eliminates repeated DB decryption for the same user/provider

## Next Steps

After proxy engine:
1. Circuit breaker implementation for downstream failures
2. Response caching for idempotent GET requests
3. Request transformation plugins (header injection, body rewriting)
