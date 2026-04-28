import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { lt } from 'drizzle-orm';
import { logger } from '@/utils/logger';
import { config } from '@/config';

export async function cleanupExpiredAuditLogs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - config.auditRetentionDays * 24 * 60 * 60 * 1000);
    const result = await db.delete(auditLogs).where(lt(auditLogs.timestamp, cutoff));
    if (result.length > 0) {
      logger.info({ count: result.length, cutoff: cutoff.toISOString() }, 'Cleaned up expired audit logs');
    }
    return result.length;
  } catch (err) {
    logger.error({ err }, 'Failed to clean up expired audit logs');
    return 0;
  }
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function startAuditRetentionCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    cleanupExpiredAuditLogs().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
}
