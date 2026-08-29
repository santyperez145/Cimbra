import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const options = {
  cwd: root,
  env: { ...process.env, CIMBRA_STANDALONE: '1' },
  stdio: 'inherit',
};

execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], options);

const standaloneRoot = join(root, '.next', 'standalone');
mkdirSync(join(standaloneRoot, '.next'), { recursive: true });
cpSync(join(root, '.next', 'static'), join(standaloneRoot, '.next', 'static'), { recursive: true });
cpSync(join(root, 'public'), join(standaloneRoot, 'public'), { recursive: true });

execFileSync(process.execPath, ['scripts/verify-standalone.mjs'], options);
execFileSync(process.execPath, ['scripts/smoke-standalone.mjs'], options);
