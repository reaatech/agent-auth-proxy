import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  host: z.string().default('0.0.0.0'),
  databaseUrl: z.string(),
  masterKey: z.string().min(1),
  agentJwtSecret: z.string().min(1),
  agentJwtExpiry: z.coerce.number().default(3600),
  adminApiKey: z.string().min(1),
  oauthRedirectUri: z.string().url().optional(),
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
  githubClientId: z.string().optional(),
  githubClientSecret: z.string().optional(),
  auditRetentionDays: z.coerce.number().default(90),
  siemEndpoint: z.string().url().optional(),
  siemApiKey: z.string().optional(),
  rateLimitGlobalMax: z.coerce.number().default(1000),
  proxyStreamTimeoutMs: z.coerce.number().default(60000),
  auditBatchSize: z.coerce.number().default(100),
  auditFlushIntervalMs: z.coerce.number().default(5000),
  proxyBodyLimitBytes: z.coerce.number().default(10 * 1024 * 1024),
  proxyStreamThresholdBytes: z.coerce.number().default(1 * 1024 * 1024),
});

export type Config = z.infer<typeof configSchema>;

const isTest = process.env.NODE_ENV === 'test';

export const config: Config = configSchema.parse({
  nodeEnv: process.env.NODE_ENV,
  port: process.env.PORT,
  host: process.env.HOST,
  databaseUrl: process.env.DATABASE_URL ?? (isTest ? 'postgresql://test:test@localhost:5432/test' : undefined),
  masterKey: process.env.MASTER_KEY,
  agentJwtSecret: process.env.AGENT_JWT_SECRET,
  agentJwtExpiry: process.env.AGENT_JWT_EXPIRY,
  adminApiKey: process.env.ADMIN_API_KEY,
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI ?? (isTest ? 'http://localhost:3000' : undefined),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  auditRetentionDays: process.env.AUDIT_RETENTION_DAYS,
  siemEndpoint: process.env.SIEM_ENDPOINT,
  siemApiKey: process.env.SIEM_API_KEY,
  rateLimitGlobalMax: process.env.RATE_LIMIT_GLOBAL_MAX,
  proxyStreamTimeoutMs: process.env.PROXY_STREAM_TIMEOUT_MS,
  auditBatchSize: process.env.AUDIT_BATCH_SIZE,
  auditFlushIntervalMs: process.env.AUDIT_FLUSH_INTERVAL_MS,
  proxyBodyLimitBytes: process.env.PROXY_BODY_LIMIT_BYTES,
  proxyStreamThresholdBytes: process.env.PROXY_STREAM_THRESHOLD_BYTES,
});
