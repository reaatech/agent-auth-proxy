import { authenticateAgent } from '@/api/middleware/auth';
import { KeyVault } from '@/auth/managers/keyVault';
import { ScopeEnforcer } from '@/auth/managers/scopeManager';
import { getOAuth2Manager } from '@/auth/managers/shared';
import { config } from '@/config';
import { type AuditLogger, getAuditLogger } from '@/services/auditService';
import { logger } from '@/utils/logger';
import {
  AppError,
  AuthError,
  ScopeError,
  UpstreamError,
  ValidationError,
  proxyParamsSchema,
} from '@reaatech/agent-auth-proxy-core';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

interface ProxyParams {
  provider: string;
  '*': string;
}

interface ProxyQuery {
  _scope?: string;
}

const providerBaseUrls: Record<string, string> = {
  google: 'https://www.googleapis.com',
  github: 'https://api.github.com',
};

function getBodyToForward(request: FastifyRequest): string | undefined {
  if (['GET', 'HEAD'].includes(request.method)) return undefined;
  if (request.body === undefined || request.body === null) return undefined;
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf-8');
  return JSON.stringify(request.body);
}

function sanitizePath(rawPath: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new ValidationError('Invalid URL encoding in path');
  }
  if (decoded.includes('\x00')) {
    throw new ValidationError('Path contains null byte');
  }
  const segments = decoded.replace(/\/{2,}/g, '/').split('/');
  const safe: string[] = [];
  for (const seg of segments) {
    if (seg === '..' || seg === '.') continue;
    safe.push(encodeURIComponent(seg));
  }
  return safe.join('/');
}

export const proxyRoutes: FastifyPluginAsync = async (fastify) => {
  const oauth2Manager = getOAuth2Manager();
  const keyVault = new KeyVault();
  const scopeEnforcer = new ScopeEnforcer();
  const auditLogger = getAuditLogger();

  fastify.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/proxy/:provider/*',
    preValidation: [authenticateAgent],
    handler: async (
      request: FastifyRequest<{ Params: ProxyParams; Querystring: ProxyQuery }>,
      reply: FastifyReply,
    ) => {
      const startTime = Date.now();
      const provider = request.params.provider;
      const rawPath = request.params['*'];
      const userId = request.headers['x-user-id'] as string;
      const agentId = request.agent?.id;
      const requestedScopes = (request.query._scope || '').split(',').filter(Boolean);

      const parsed = proxyParamsSchema.safeParse({ provider, path: rawPath });
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }

      if (!userId) {
        throw new AppError('MISSING_USER_ID', 'X-User-ID header is required', 400);
      }

      if (!uuidSchema.safeParse(userId).success) {
        throw new ValidationError('X-User-ID must be a valid UUID');
      }

      if (!agentId) {
        throw new AuthError('MISSING_AGENT_ID', 'Agent authentication required');
      }

      const path = sanitizePath(rawPath);
      const baseUrl = providerBaseUrls[provider];
      if (!baseUrl) {
        throw new ValidationError(`Provider ${provider} not supported`);
      }

      try {
        const scopeResult = await scopeEnforcer.validateRequest(
          userId,
          agentId,
          requestedScopes,
          provider,
        );
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
          throw new ScopeError(
            scopeResult.reason || 'SCOPE_DENIED',
            `Request blocked: ${scopeResult.reason}`,
            {
              grantedScopes: scopeResult.grantedScopes,
              requestedScopes: scopeResult.requestedScopes,
            },
          );
        }

        let credential: { type: 'bearer' | 'api_key'; value: string; headerName?: string };

        try {
          const token = await oauth2Manager.getValidToken(userId, provider, requestedScopes);
          credential = { type: 'bearer', value: token };
        } catch {
          try {
            const apiKey = await keyVault.getApiKey(userId, provider);
            credential = { type: 'api_key', value: apiKey, headerName: 'Authorization' };
          } catch {
            throw new AuthError(
              'NO_CREDENTIALS',
              `No valid credentials found for user ${userId} and provider ${provider}`,
            );
          }
        }

        const downstreamUrl = `${baseUrl}/${path}`;
        const downstreamHeaders: Record<string, string> = {};

        for (const [key, value] of Object.entries(request.headers)) {
          const lowerKey = key.toLowerCase();
          if (
            [
              'host',
              'authorization',
              'x-user-id',
              'x-admin-api-key',
              'content-length',
              'cookie',
              'x-forwarded-for',
              'x-forwarded-proto',
              'x-forwarded-host',
              'x-forwarded-port',
              'x-real-ip',
            ].includes(lowerKey)
          )
            continue;
          if (typeof value === 'string') {
            downstreamHeaders[key] = value;
          }
        }

        downstreamHeaders['X-Forwarded-By'] = 'agent-auth-proxy';
        downstreamHeaders['X-Proxy-User-ID'] = userId;

        if (credential.type === 'bearer') {
          downstreamHeaders.Authorization = `Bearer ${credential.value}`;
        } else if (credential.type === 'api_key' && credential.headerName) {
          downstreamHeaders[credential.headerName] = credential.value;
        }

        const originalContentType = request.headers['content-type'];
        if (originalContentType && typeof originalContentType === 'string') {
          downstreamHeaders['Content-Type'] = originalContentType;
        }

        const body = getBodyToForward(request);
        const downstreamResponse = await fetch(downstreamUrl, {
          method: request.method,
          headers: downstreamHeaders,
          body,
        });

        if (downstreamResponse.status === 401 && credential.type === 'bearer') {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
            await auditLogger.log({
              eventType: 'security_event',
              userId,
              agentId,
              action: 'proxy_request',
              resource: `${provider}:${path}`,
              outcome: 'failure',
              statusCode: 401,
              details: { reason: 'non_idempotent_401_not_retried', method: request.method },
            });
            return forwardResponse(
              downstreamResponse,
              reply,
              startTime,
              userId,
              agentId,
              provider,
              path,
              auditLogger,
            );
          }

          const refreshedToken = await oauth2Manager.refreshAccessToken(userId, provider);
          downstreamHeaders.Authorization = `Bearer ${refreshedToken}`;

          const retryResponse = await fetch(downstreamUrl, {
            method: request.method,
            headers: downstreamHeaders,
            body,
          });

          return forwardResponse(
            retryResponse,
            reply,
            startTime,
            userId,
            agentId,
            provider,
            path,
            auditLogger,
          );
        }

        return forwardResponse(
          downstreamResponse,
          reply,
          startTime,
          userId,
          agentId,
          provider,
          path,
          auditLogger,
        );
      } catch (error) {
        const duration = Date.now() - startTime;
        if (
          error instanceof AuthError ||
          error instanceof ScopeError ||
          error instanceof ValidationError
        ) {
          throw error;
        }
        logger.error({ err: error, userId, provider, path, duration }, 'Proxy request failed');

        await auditLogger.log({
          eventType: 'api_call',
          userId,
          agentId,
          action: 'proxy_request',
          resource: `${provider}:${path}`,
          outcome: 'failure',
          details: { error: (error as Error).message, duration },
        });

        throw new UpstreamError((error as Error).message);
      }
    },
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
  auditLogger: AuditLogger,
) {
  const duration = Date.now() - startTime;

  const strippedHeaders = [
    'set-cookie',
    'www-authenticate',
    'x-amz-id-2',
    'x-amz-request-id',
    'x-frame-options',
    'content-security-policy',
    'x-powered-by',
  ];
  const safeHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (!strippedHeaders.includes(key.toLowerCase())) {
      safeHeaders[key] = value;
    }
  });

  reply.code(response.status);
  for (const [key, value] of Object.entries(safeHeaders)) {
    reply.header(key, value);
  }
  reply.header('X-Request-ID', crypto.randomUUID());
  reply.header('X-Duration-Ms', duration);

  const contentType = response.headers.get('content-type') || '';
  const contentLengthStr = response.headers.get('content-length');
  const contentLength = contentLengthStr ? Number.parseInt(contentLengthStr, 10) : null;
  const isStream =
    contentType.includes('text/event-stream') ||
    response.headers.get('transfer-encoding') === 'chunked';

  const logAudit = (
    outcome: 'success' | 'failure',
    statusCode: number,
    details?: Record<string, unknown>,
  ) =>
    auditLogger.log({
      eventType: 'api_call',
      userId,
      agentId,
      action: 'proxy_request',
      resource: `${provider}:${path}`,
      outcome,
      statusCode,
      durationMs: duration,
      details: { provider, path, duration, ...details },
    });

  if (
    isStream ||
    (response.body && contentLength !== null && contentLength > config.proxyStreamThresholdBytes)
  ) {
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');

    const reader = response.body?.getReader();
    if (!reader) {
      reply.raw.end();
      return;
    }
    const timeoutMs = config.proxyStreamTimeoutMs;
    let streamEnded = false;

    const safeEnd = () => {
      if (!streamEnded) {
        streamEnded = true;
        try {
          reply.raw.end();
        } catch {
          /* already ended */
        }
      }
    };

    const timeout = setTimeout(() => {
      void reader.cancel().catch(() => {});
    }, timeoutMs);

    reply.raw.on('close', () => {
      clearTimeout(timeout);
      void reader.cancel().catch(() => {});
    });

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value) reply.raw.write(result.value);
      }
    } catch {
      clearTimeout(timeout);
      safeEnd();
      await logAudit('failure', response.status, { streaming: true, error: 'stream_closed' });
      return;
    } finally {
      clearTimeout(timeout);
      safeEnd();
    }

    await logAudit('success', response.status, { streaming: true });
    return;
  }

  try {
    const body = await response.text();
    reply.send(body);
    await logAudit('success', response.status);
  } catch {
    try {
      reply.raw.end();
    } catch {
      /* ignore */
    }
    await logAudit('failure', response.status, { error: 'body_read_failed' });
  }
}
