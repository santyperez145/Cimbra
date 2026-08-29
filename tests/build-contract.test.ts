import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('el build siempre produce el runtime standalone usado por start y la imagen OCI', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const nextConfig = readFileSync(join(root, 'next.config.ts'), 'utf8');
  const buildScript = readFileSync(join(root, 'scripts', 'build-next.mjs'), 'utf8');
  const vercelBuild = readFileSync(join(root, 'scripts', 'vercel-build.mjs'), 'utf8');
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

  assert.match(nextConfig, /output:\s*['"]standalone['"]/);
  assert.doesNotMatch(nextConfig, /process\.env\.VERCEL[^\n]+output/);
  assert.match(nextConfig, /CIMBRA_STANDALONE === '1'/);
  assert.match(packageJson.scripts.build, /build-next\.mjs/);
  assert.match(buildScript, /CIMBRA_STANDALONE: '1'/);
  assert.match(buildScript, /verify-standalone\.mjs/);
  assert.doesNotMatch(vercelBuild, /CIMBRA_STANDALONE/);
  assert.match(packageJson.scripts.start, /\.next\/standalone\/server\.js/);
  assert.match(dockerfile, /\/app\/\.next\/standalone/);
});

test('el selector de período gobierna métricas y actividad persistidas', () => {
  const dashboard = readFileSync(join(root, 'db', 'runtime.ts'), 'utf8');
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');

  assert.match(dashboard, /periodSummaries:\s*Record<'7d' \| '30d'/);
  assert.match(dashboard, /COUNT\(\*\) FILTER \(WHERE created_at >= seven_start\)/);
  assert.match(consoleClient, /value=\{overviewPeriod\}/);
  assert.match(consoleClient, /data\.periodSummaries\[overviewPeriod\]/);
  assert.doesNotMatch(consoleClient, /<select aria-label="Período"><option>/);
});
