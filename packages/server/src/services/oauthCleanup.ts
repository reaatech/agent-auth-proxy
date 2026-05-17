import { lt } from 'drizzle-orm';
import { db } from '@/db';
import { oauthStates } from '@/db/schema';
import { logger } from '@/utils/logger';

export async function cleanupExpiredOAuthStates(): Promise<number> {
  try {
    const result = await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    if (result.length > 0) {
      logger.info({ count: result.length }, 'Cleaned up expired OAuth states');
    }
    return result.length;
  } catch (err) {
    logger.error({ err }, 'Failed to clean up expired OAuth states');
    return 0;
  }
}

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

export function startOAuthStateCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    cleanupExpiredOAuthStates().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
}
