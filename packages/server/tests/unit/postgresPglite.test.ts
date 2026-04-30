import { createPostgresPglite } from '@/db/postgres-pglite';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('postgres-pglite', () => {
  it('should execute tagged template queries', async () => {
    const pglite = new PGlite('memory://');
    await pglite.waitReady;
    const sql = createPostgresPglite(pglite);

    const result = await sql`SELECT ${1} as num`;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    await pglite.close();
  });

  it('should execute unsafe queries', async () => {
    const pglite = new PGlite('memory://');
    await pglite.waitReady;
    const sql = createPostgresPglite(pglite);

    const result = sql.unsafe('SELECT $1 as num', ['2']);
    const rows = await result;
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('num');

    await pglite.close();
  });

  it('should support transactions', async () => {
    const pglite = new PGlite('memory://');
    await pglite.waitReady;
    const sql = createPostgresPglite(pglite);

    await sql.begin(async (client) => {
      const result = await client.unsafe('SELECT 3 as num');
      expect(result).toEqual([{ num: 3 }]);
    });

    await pglite.close();
  });
});
