# Skill: Audit Logging

## Overview

Creates a comprehensive audit logging system with structured JSON logs, database persistence, and optional SIEM integration. Every authentication, authorization, token operation, and proxy request is logged with full context for compliance and security analysis.

## Metadata

- **Name**: Audit Logging
- **Description**: Structured audit logs with database storage, log streaming, and retention policies
- **Complexity**: Medium
- **Estimated Time**: 2 hours
- **Dependencies**: Project Scaffolding, Database Schema

## Inputs

```typescript
interface AuditLoggingInputs {
  siemEndpoint?: string;           // Optional SIEM webhook URL
  siemApiKey?: string;             // SIEM authentication
  retentionDays?: number;          // Default: 90
  logLevel?: 'debug' | 'info' | 'warn' | 'error'; // Default: 'info'
  batchSize?: number;              // Default: 100 (batch insert threshold)
  flushIntervalMs?: number;        // Default: 5000
}
```

## Outputs

### Core Audit Logger

#### src/services/auditService.ts

```typescript
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { pino } from 'pino';

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
  private logger = pino({ name: 'audit' });
  private batch: AuditLogEntry[] = [];
  private batchSize: number;
  private flushInterval: NodeJS.Timeout;
  private siemEndpoint?: string;
  private siemApiKey?: string;

  constructor(config: AuditLoggingInputs = {}) {
    this.batchSize = config.batchSize || 100;
    this.siemEndpoint = config.siemEndpoint;
    this.siemApiKey = config.siemApiKey;
    
    // Flush batch every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), config.flushIntervalMs || 5000);
  }

  async log(entry: AuditLogEntry): Promise<void> {
    const enriched: AuditLogEntry = {
      ...entry,
      eventCategory: entry.eventCategory || this.inferCategory(entry.eventType),
    };

    // Always write to structured log immediately
    this.logger.info({
      ...enriched,
      timestamp: new Date().toISOString(),
    });

    // Batch database writes
    this.batch.push(enriched);
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    }

    // Send security events to SIEM immediately
    if (this.isSecurityEvent(enriched) && this.siemEndpoint) {
      await this.sendToSiem(enriched);
    }
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const toInsert = this.batch.splice(0, this.batch.length);
    
    try {
      await db.insert(auditLogs).values(toInsert.map(entry => ({
        eventType: entry.eventType,
        eventCategory: entry.eventCategory!,
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
      })));
    } catch (dbError) {
      // If DB fails, log to stderr but don't crash the request
      this.logger.error({ err: dbError, batchSize: toInsert.length }, 'Audit log DB insert failed');
    }
  }

  private async sendToSiem(entry: AuditLogEntry): Promise<void> {
    try {
      await fetch(this.siemEndpoint!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.siemApiKey}`,
        },
        body: JSON.stringify(entry),
      });
    } catch (err) {
      this.logger.error({ err, eventType: entry.eventType }, 'SIEM forwarding failed');
    }
  }

  private isSecurityEvent(entry: AuditLogEntry): boolean {
    return entry.eventType === 'scope_violation' ||
           entry.eventType === 'security_event' ||
           (entry.eventType === 'authentication' && entry.outcome === 'failure');
  }

  private inferCategory(eventType: AuditEventType): string {
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
    return map[eventType] || 'proxy';
  }

  async dispose(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
  }
}
```

### Retention Cleanup

```typescript
// scripts/cleanup-audit-logs.ts
import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { lt } from 'drizzle-orm';

const RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || '90', 10);

async function cleanup() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.delete(auditLogs).where(lt(auditLogs.timestamp, cutoff));
  console.log(`Deleted ${result.rowCount} audit logs older than ${cutoff.toISOString()}`);
}

cleanup().then(() => process.exit(0));
```

## Validation

After running this skill, verify:
- [ ] All auth events are logged (success and failure)
- [ ] All proxy requests are logged with duration
- [ ] Scope violations are logged as security events
- [ ] Batch inserts work correctly under load
- [ ] SIEM receives security events in real-time
- [ ] Old logs are deleted after retention period
- [ ] Log DB failures don't crash requests

## Security Considerations

- Never log plaintext tokens, API keys, or passwords in `details`
- IP addresses should be hashed or truncated in high-privacy deployments
- Audit logs themselves should be tamper-evident (append-only, signed)
- Database audit_logs table should have restrictive write permissions

## Next Steps

After audit logging:
1. Security hardening (alerting on anomaly patterns)
2. Compliance reporting endpoints
3. Log aggregation dashboards
