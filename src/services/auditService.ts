import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { logger } from '@/utils/logger';
import { config } from '@/config';

export type AuditEventType =
  | 'authentication'
  | 'authorization'
  | 'token_refresh'
  | 'api_call'
  | 'scope_violation'
  | 'configuration_change'
  | 'security_event'
  | 'token_created'
  | 'token_revoked'
  | 'grant_created'
  | 'grant_revoked';

export interface AuditLogEntry {
  eventType: AuditEventType;
  eventCategory?: 'auth' | 'proxy' | 'security' | 'admin';
  userId?: string;
  agentId?: string;
  serviceAccountId?: string;
  ipAddress?: string;
  userAgent?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  outcome: 'success' | 'failure' | 'blocked';
  statusCode?: number;
  details?: Record<string, unknown>;
  sessionId?: string;
  traceId?: string;
  spanId?: string;
  durationMs?: number;
}

export class AuditLogger {
  private batch: AuditLogEntry[] = [];
  private batchSize = 100;
  private flushInterval: NodeJS.Timeout | null = null;
  private siemEndpoint?: string;
  private siemApiKey?: string;
  private disposed = false;

  constructor() {
    this.siemEndpoint = config.siemEndpoint;
    this.siemApiKey = config.siemApiKey;
    this.batchSize = config.auditBatchSize;
    this.flushInterval = setInterval(() => {
      this.flush().catch(() => {});
    }, config.auditFlushIntervalMs);
  }

  async log(entry: AuditLogEntry): Promise<void> {
    if (this.disposed) return;

    const enriched: AuditLogEntry = {
      ...entry,
      eventCategory: entry.eventCategory || this.inferCategory(entry.eventType),
    };

    logger.info({ ...enriched, timestamp: new Date().toISOString() }, 'audit');

    this.batch.push(enriched);
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }

    if (this.isSecurityEvent(enriched) && this.siemEndpoint) {
      this.sendToSiem(enriched).catch(err => {
        logger.error({ err, eventType: entry.eventType }, 'SIEM forwarding failed');
      });
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const toInsert = this.batch.splice(0, this.batch.length);

    try {
      await db.insert(auditLogs).values(
        toInsert.map(entry => ({
          eventType: entry.eventType,
          eventCategory: entry.eventCategory as 'auth' | 'proxy' | 'security' | 'admin',
          userId: entry.userId,
          agentId: entry.agentId,
          serviceAccountId: entry.serviceAccountId,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId,
          outcome: entry.outcome,
          statusCode: entry.statusCode,
          details: entry.details,
          sessionId: entry.sessionId,
          traceId: entry.traceId,
          spanId: entry.spanId,
          durationMs: entry.durationMs,
        })),
      );
    } catch (dbError) {
      logger.error({ err: dbError, batchSize: toInsert.length }, 'Audit log DB insert failed');
    }
  }

  private async sendToSiem(entry: AuditLogEntry): Promise<void> {
    if (!this.siemEndpoint) return;
    await fetch(this.siemEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.siemApiKey}`,
      },
      body: JSON.stringify(entry),
    });
  }

  private isSecurityEvent(entry: AuditLogEntry): boolean {
    return (
      entry.eventType === 'scope_violation' ||
      entry.eventType === 'security_event' ||
      (entry.eventType === 'authentication' && entry.outcome === 'failure')
    );
  }

  private inferCategory(eventType: AuditEventType): 'auth' | 'proxy' | 'security' | 'admin' {
    const map: Record<string, string> = {
      authentication: 'auth',
      authorization: 'auth',
      token_refresh: 'auth',
      token_created: 'auth',
      token_revoked: 'auth',
      api_call: 'proxy',
      scope_violation: 'security',
      security_event: 'security',
      configuration_change: 'admin',
      grant_created: 'admin',
      grant_revoked: 'admin',
    };
    return (map[eventType] || 'proxy') as 'auth' | 'proxy' | 'security' | 'admin';
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

let defaultInstance: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!defaultInstance || defaultInstance['disposed']) {
    defaultInstance = new AuditLogger();
  }
  return defaultInstance;
}
