import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle-postgres',
  schema: './db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING
      ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '',
  },
});
