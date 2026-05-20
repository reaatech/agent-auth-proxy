import { sql } from 'drizzle-orm';
import { db } from '@/db';

let _dbAvailable: boolean | null = null;

export async function isDbAvailable(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.execute(sql`SELECT 1`);
    _dbAvailable = true;
  } catch {
    _dbAvailable = false;
  }
  return _dbAvailable;
}

export function skipIfNoDb(): boolean | Promise<boolean> {
  return isDbAvailable().then((available) => !available);
}

export function withFetchMock<T>(setup: () => T, restore: () => T): { run: <R>(fn: () => R) => R } {
  return {
    run: <R>(fn: () => R): R => {
      const original = setup();
      try {
        return fn();
      } finally {
        restore();
        void original;
      }
    },
  };
}
