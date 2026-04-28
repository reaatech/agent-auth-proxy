/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { db } from '@/db';
import { scopes } from '@/db/schema';
import { logger } from '@/utils/logger';

async function seed() {
  logger.info('Seeding database...');

  await db.insert(scopes).values([
    { name: 'email', provider: 'google', description: 'View your email address', category: 'read', riskLevel: 'low' },
    { name: 'profile', provider: 'google', description: 'View your basic info', category: 'read', riskLevel: 'low' },
    { name: 'openid', provider: 'google', description: 'Associate you with your Personal Info', category: 'read', riskLevel: 'low' },
    { name: 'https://www.googleapis.com/auth/calendar.readonly', provider: 'google', description: 'View your calendars', category: 'read', riskLevel: 'medium' },
    { name: 'https://www.googleapis.com/auth/calendar.events', provider: 'google', description: 'View and edit events on your calendars', category: 'write', riskLevel: 'high' },
    { name: 'user:email', provider: 'github', description: 'View your email address', category: 'read', riskLevel: 'low' },
    { name: 'user:read', provider: 'github', description: 'View your user data', category: 'read', riskLevel: 'low' },
    { name: 'repo', provider: 'github', description: 'Full control of private repositories', category: 'write', riskLevel: 'high' },
  ]).onConflictDoNothing();

  logger.info('Seed complete');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });
