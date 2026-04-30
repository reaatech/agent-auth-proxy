import { authRoutes } from '@/api/routes/auth';
import { healthRoutes } from '@/api/routes/health';
import { managementRoutes } from '@/api/routes/management';
import { config } from '@/config';
import { proxyRoutes } from '@/proxy/engine';
import { startAuditRetentionCleanup } from '@/services/auditCleanup';
import { getAuditLogger } from '@/services/auditService';
import { startOAuthStateCleanup } from '@/services/oauthCleanup';
import { logger } from '@/utils/logger';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastify from 'fastify';
import { Counter, Histogram, collectDefaultMetrics, register } from 'prom-client';

let metricsInitialized = false;
let shutdownSignalled = false;

declare module 'fastify' {
  interface FastifyRequest {
    agent?: { id: string; name: string };
  }
}

export async function buildApp() {
  const app = fastify({
    loggerInstance: logger as unknown as import('fastify').FastifyBaseLogger,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: config.proxyBodyLimitBytes,
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    strictTransportSecurity: {
      maxAge: 15552000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  // CORS
  // In production, CORS is disabled (internal API behind auth gateway).
  // In development, any origin is allowed for local testing.
  await app.register(cors, {
    origin: config.nodeEnv !== 'production',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'X-User-ID', 'X-Admin-API-Key', 'Content-Type'],
    credentials: false,
  });

  // JWT for agent authentication
  await app.register(jwt, {
    secret: config.agentJwtSecret,
    sign: { expiresIn: config.agentJwtExpiry },
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimitGlobalMax,
    timeWindow: '15 minutes',
  });

  // Decorate with config
  app.decorate('config', config);

  // Error handler - MUST be set before routes in Fastify 5
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    const statusCode = (error as Error & { statusCode?: number }).statusCode || 500;
    const code = (error as Error & { code?: string }).code || 'INTERNAL_ERROR';
    const message =
      config.nodeEnv === 'production' && statusCode === 500
        ? 'Internal server error'
        : error.message;

    logger.error({ err: error, reqId: request.id, statusCode }, 'Request error');

    if (reply.raw.headersSent) {
      return;
    }

    reply.code(statusCode).type('application/json').send({
      error: code,
      message,
      requestId: request.id,
    });
  });

  // Prometheus metrics setup (idempotent across buildApp calls)
  if (!metricsInitialized) {
    collectDefaultMetrics({ register });
    metricsInitialized = true;
  }

  const httpRequestsTotal =
    (register.getSingleMetric('http_requests_total') as Counter<string>) ||
    new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [register],
    });

  const httpRequestDuration =
    (register.getSingleMetric('http_request_duration_seconds') as Histogram<string>) ||
    new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [register],
    });

  // Global metrics hook - covers all registered routes
  app.addHook('onResponse', (request, reply) => {
    const route = request.routeOptions.url || request.url;
    const statusCode = reply.statusCode.toString();
    httpRequestsTotal.inc({ method: request.method, route, status_code: statusCode });
    const elapsed = (reply.elapsedTime ?? 0) / 1000;
    httpRequestDuration.observe(
      { method: request.method, route, status_code: statusCode },
      elapsed,
    );
  });

  // Routes
  await app.register(healthRoutes, { prefix: '' });
  await app.register(authRoutes, { prefix: '' });
  await app.register(proxyRoutes, { prefix: '' });
  await app.register(managementRoutes, { prefix: '/api/v1' });

  return app;
}

/**
 * Build the app, register signal handlers, listen on the configured port,
 * and start cleanup timers. Returns once the server is listening.
 */
export async function start() {
  const app = await buildApp();

  let oauthCleanupTimer: NodeJS.Timeout | null = null;
  let auditCleanupTimer: NodeJS.Timeout | null = null;

  const shutdown = async (signal: string) => {
    if (shutdownSignalled) return;
    shutdownSignalled = true;
    logger.info({ signal }, 'Shutdown initiated');

    if (oauthCleanupTimer) clearInterval(oauthCleanupTimer);
    if (auditCleanupTimer) clearInterval(auditCleanupTimer);

    const auditLogger = getAuditLogger();
    await auditLogger.dispose();

    try {
      await app.close();
      logger.info('Server closed');
    } catch (err) {
      logger.error({ err }, 'Error closing server');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`Server listening on ${config.host}:${config.port}`);
    oauthCleanupTimer = startOAuthStateCleanup();
    auditCleanupTimer = startAuditRetentionCleanup();
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  return app;
}
