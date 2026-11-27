import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { env } from "./env";

// One pool per function instance. attachDatabasePool releases idle clients
// before Fluid compute suspends the instance, so a sleeping function never
// holds a connection open — which would also keep Neon's compute awake.
//
// The schema belongs to pipeline/migrations, applied by the worker's
// Store.migrate(). This app reads and writes those tables with plain SQL and
// never defines or migrates them, so there is exactly one owner of the schema.
let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env("DATABASE_URL"), max: 5, idleTimeoutMillis: 10_000 });
    attachDatabasePool(pool);
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query<T>(text, params);
  return rows;
}

export async function one<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
