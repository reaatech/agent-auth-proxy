import { pgTable, uuid, varchar, text, timestamp, boolean, unique, index } from 'drizzle-orm/pg-core';

export const scopes = pgTable('scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  provider: varchar('provider', { length: 100 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull(),
  riskLevel: varchar('risk_level', { length: 20 }).notNull(),
  requiresReconsent: boolean('requires_reconsent').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  nameProviderUnique: unique('scopes_name_provider_unique').on(table.name, table.provider),
  providerIdx: index('idx_scopes_provider').on(table.provider),
}));

export type Scope = typeof scopes.$inferSelect;
export type NewScope = typeof scopes.$inferInsert;
