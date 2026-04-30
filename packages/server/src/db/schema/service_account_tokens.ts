import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Service account token support is planned for v2. Table exists for schema compatibility.
import { serviceAccounts } from './service_accounts';

export const serviceAccountTokens = pgTable('service_account_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceAccountId: uuid('service_account_id')
    .notNull()
    .references(() => serviceAccounts.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  tokenPrefix: varchar('token_prefix', { length: 8 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  metadata: jsonb('metadata').default({}),
});

export type ServiceAccountToken = typeof serviceAccountTokens.$inferSelect;
export type NewServiceAccountToken = typeof serviceAccountTokens.$inferInsert;
