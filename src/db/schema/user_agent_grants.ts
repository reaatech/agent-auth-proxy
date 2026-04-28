import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { agents } from './agents';

export const userAgentGrants = pgTable('user_agent_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  scopes: text('scopes').array().notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  userAgentIdx: index('idx_user_agent_grants_user_agent').on(table.userId, table.agentId),
}));

export type UserAgentGrant = typeof userAgentGrants.$inferSelect;
export type NewUserAgentGrant = typeof userAgentGrants.$inferInsert;
