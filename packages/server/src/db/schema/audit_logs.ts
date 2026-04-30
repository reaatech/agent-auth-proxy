import {
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { serviceAccounts } from './service_accounts';
import { users } from './users';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    eventCategory: varchar('event_category', { length: 50 }).notNull(),
    userId: uuid('user_id').references(() => users.id),
    agentId: uuid('agent_id').references(() => agents.id),
    serviceAccountId: uuid('service_account_id').references(() => serviceAccounts.id),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    action: varchar('action', { length: 255 }).notNull(),
    resource: varchar('resource', { length: 255 }),
    resourceId: uuid('resource_id'),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    statusCode: integer('status_code'),
    details: jsonb('details').default({}),
    sessionId: uuid('session_id'),
    traceId: uuid('trace_id'),
    spanId: uuid('span_id'),
    durationMs: integer('duration_ms'),
  },
  (table) => ({
    timestampIdx: index('idx_audit_logs_timestamp').on(table.timestamp),
    userIdIdx: index('idx_audit_logs_user_id').on(table.userId),
    eventTypeIdx: index('idx_audit_logs_event_type').on(table.eventType),
    outcomeIdx: index('idx_audit_logs_outcome').on(table.outcome),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
