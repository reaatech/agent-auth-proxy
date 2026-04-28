import { beforeAll, afterAll, afterEach } from 'vitest';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

let dbAvailable = false;

try {
  await db.execute(sql`SELECT 1`);
  dbAvailable = true;
} catch {
  // Database not available
}

beforeAll(async () => {
  if (!dbAvailable) return;
  // Run migrations
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

afterEach(async () => {
  if (!dbAvailable) return;
  const tables = [
    'oauth_states',
    'oauth_tokens',
    'api_keys',
    'user_agent_grants',
    'audit_logs',
    'service_account_tokens',
    'service_accounts',
    'agents',
    'users',
    'scopes',
  ];
  for (const table of tables) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE`));
  }
});

afterAll(async () => {
  // Connection cleanup if needed
});
