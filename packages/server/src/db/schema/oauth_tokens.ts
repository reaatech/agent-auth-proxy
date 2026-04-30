import { index, jsonb, pgTable, text, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users';

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 100 }).notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    accessTokenIv: text('access_token_iv').notNull(),
    accessTokenAuthTag: text('access_token_auth_tag').notNull(),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    refreshTokenIv: text('refresh_token_iv'),
    refreshTokenAuthTag: text('refresh_token_auth_tag'),
    tokenType: varchar('token_type', { length: 50 }).default('Bearer'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    scopes: text('scopes').array().notNull(),
    idTokenEncrypted: text('id_token_encrypted'),
    idTokenIv: text('id_token_iv'),
    idTokenAuthTag: text('id_token_auth_tag'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
  },
  (table) => ({
    uniqueUserProvider: unique('oauth_tokens_user_id_provider_unique').on(
      table.userId,
      table.provider,
    ),
    userProviderIdx: index('idx_oauth_tokens_user_provider').on(table.userId, table.provider),
  }),
);

export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
