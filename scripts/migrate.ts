/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '@/db';
import { logger } from '@/utils/logger';

async function runMigrations() {
  logger.info('Running migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  logger.info('Migrations complete');
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Migration failed');
    process.exit(1);
  });
