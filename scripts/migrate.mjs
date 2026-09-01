import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { postgresClientOptions, resolvePostgresUrl } from '../db/postgres-connection.mjs';

const url = resolvePostgresUrl({ preferDirect: true });
const client = postgres(url, postgresClientOptions(url, { max: 1 }));

try {
  await migrate(drizzle(client), { migrationsFolder: resolve('drizzle-postgres') });
  console.log(JSON.stringify({ ok: true, action: 'database-migrate' }));
} finally {
  await client.end();
}
