import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

function databaseUrl() {
  const configured = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (configured) return configured;
  const { DB_HOST: host, DB_PORT: port = '5432', DB_NAME: database, DB_USER: user, DB_PASSWORD: password } = process.env;
  if (host && database && user && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  }
  throw new Error('Database connection variables are not configured.');
}

const url = databaseUrl();
const client = postgres(url, {
  max: 1,
  prepare: false,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
});

try {
  await migrate(drizzle(client), { migrationsFolder: resolve('drizzle-postgres') });
  console.log(JSON.stringify({ ok: true, action: 'database-migrate' }));
} finally {
  await client.end();
}
