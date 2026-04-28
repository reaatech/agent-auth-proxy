import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '@/config';
import * as schema from './schema';

let sql: ReturnType<typeof postgres>;

async function connectWithRetry(url: string, retries = 5, delayMs = 1000): Promise<ReturnType<typeof postgres>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const pg = postgres(url, {
        max: 20,
        idle_timeout: 30,
        connect_timeout: 10,
      });
      await pg`SELECT 1`;
      return pg;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error('Unreachable');
}

if (config.nodeEnv === 'test' && process.env.USE_PGLITE === 'true') {
  const { createPostgresPglite } = await import('./postgres-pglite');
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite('memory://');
  await pglite.waitReady;
  sql = createPostgresPglite(pglite) as unknown as ReturnType<typeof postgres>;
} else {
  sql = await connectWithRetry(config.databaseUrl);
}

export const db = drizzle(sql, { schema });
export type Database = typeof db;
