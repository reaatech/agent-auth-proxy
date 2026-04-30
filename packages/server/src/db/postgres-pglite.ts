import type { PGlite, Transaction } from '@electric-sql/pglite';

interface PostgresLikeResult<T> extends Promise<T[]> {
  values(): Promise<unknown[][]>;
}

function createResult<T>(promise: Promise<T[]>): PostgresLikeResult<T> {
  const valuesPromise = promise.then((rows) =>
    rows.map((row) => Object.values(row as Record<string, unknown>)),
  );

  const result = {
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for postgres-js driver compatibility
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
    values: () => valuesPromise,
  } as unknown as PostgresLikeResult<T>;

  return result;
}

function createUnsafe(pglite: PGlite | Transaction) {
  return (query: string, params: unknown[] = []) => {
    const promise = pglite.query(query, params).then((result) => result.rows);
    return createResult(promise);
  };
}

/**
 * Creates a postgres-js compatible interface on top of PGlite
 * so Drizzle ORM's postgres-js driver can work with an in-memory DB.
 */
export function createPostgresPglite(pglite: PGlite) {
  const unsafe = createUnsafe(pglite);

  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((acc, str, i) => `${acc + str}$${i + 1}`, '');
      const result = await pglite.query(query, values);
      return result.rows;
    },
    {
      unsafe,
      begin: async (callback: (client: { unsafe: typeof unsafe }) => Promise<unknown>) => {
        return pglite.transaction(async (tx) => {
          const txUnsafe = createUnsafe(tx);
          return callback({ unsafe: txUnsafe });
        });
      },
      options: {
        parsers: {},
        serializers: {},
      },
    },
  );

  return sql;
}
