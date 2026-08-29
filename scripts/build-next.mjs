import { execFileSync } from 'node:child_process';

const options = {
  cwd: process.cwd(),
  env: { ...process.env, CIMBRA_STANDALONE: '1' },
  stdio: 'inherit',
};

execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], options);
execFileSync(process.execPath, ['scripts/verify-standalone.mjs'], options);
