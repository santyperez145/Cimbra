import { execFileSync } from 'node:child_process';

const options = { cwd: process.cwd(), env: process.env, stdio: 'inherit' };

if (process.env.VERCEL_ENV === 'production') {
  execFileSync(process.execPath, ['scripts/migrate.mjs'], options);
} else {
  console.log(JSON.stringify({ ok: true, action: 'database-migrate', skipped: true, reason: 'non-production-build' }));
}

execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], options);
