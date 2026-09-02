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
  const smokeScript = readFileSync(join(root, 'scripts', 'smoke-standalone.mjs'), 'utf8');
  const vercelBuild = readFileSync(join(root, 'scripts', 'vercel-build.mjs'), 'utf8');
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

  assert.match(nextConfig, /output:\s*['"]standalone['"]/);
  assert.doesNotMatch(nextConfig, /process\.env\.VERCEL[^\n]+output/);
  assert.match(nextConfig, /CIMBRA_STANDALONE === '1'/);
  assert.match(packageJson.scripts.build, /build-next\.mjs/);
  assert.match(buildScript, /CIMBRA_STANDALONE: '1'/);
  assert.match(buildScript, /cpSync\(join\(root, '\.next', 'static'\), join\(standaloneRoot, '\.next', 'static'\)/);
  assert.match(buildScript, /cpSync\(join\(root, 'public'\), join\(standaloneRoot, 'public'\)/);
  assert.match(buildScript, /verify-standalone\.mjs/);
  assert.match(buildScript, /smoke-standalone\.mjs/);
  assert.doesNotMatch(vercelBuild, /CIMBRA_STANDALONE/);
  assert.match(packageJson.scripts.start, /\.next\/standalone\/server\.js/);
  assert.match(packageJson.scripts['start:smoke'], /smoke-standalone\.mjs/);
  assert.match(smokeScript, /fetchRequired\('\/terms'\)/);
  assert.match(smokeScript, /\/_next\\\/static\\\//);
  assert.match(smokeScript, /fetchRequired\('\/favicon\.svg'\)/);
  assert.match(dockerfile, /\/app\/\.next\/standalone/);
});

test('la navegación global ofrece 404 y recuperación explícita sin interceptar el redirect de sesión', () => {
  const routeError = readFileSync(join(root, 'app', 'error.tsx'), 'utf8');
  const globalError = readFileSync(join(root, 'app', 'global-error.tsx'), 'utf8');
  const notFound = readFileSync(join(root, 'app', 'not-found.tsx'), 'utf8');

  assert.match(routeError, /onClick=\{reset\}/);
  assert.match(routeError, /error\.digest/);
  assert.match(routeError, /href="\/console"/);
  assert.match(globalError, /<html lang="es">/);
  assert.match(globalError, /onClick=\{reset\}/);
  assert.match(notFound, /404 · RUTA NO ENCONTRADA/);
  assert.match(notFound, /href="\/developers"/);
  assert.throws(() => readFileSync(join(root, 'app', 'loading.tsx'), 'utf8'));
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

test('el estado de cuenta conserva layout de formulario y métricas responsive', () => {
  const panel = readFileSync(join(root, 'app', 'console', 'book-transfers-panel.tsx'), 'utf8');
  const styles = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
  assert.match(panel, /className="book-statement-body"/);
  assert.match(styles, /\.book-statement-body>label select\{[^}]*width:100%[^}]*height:40px/);
  assert.match(styles, /\.book-statement-body \.module-metrics\{grid-template-columns:1fr 1fr/);
  assert.match(styles, /\.book-transfers-console \.integration-card>\.danger-link\{[^}]*border:1px solid[^}]*font:650/);
  assert.match(styles, /@media\(max-width:620px\).*\.book-statement-body \.module-metrics\{grid-template-columns:1fr\}/);
  assert.match(styles, /@media\(max-width:620px\).*\.book-transfers-console>\.module-list>div:not\(\.card-head\)\{[^}]*flex-direction:column/);
});

test('la consola opera el padrón de clientes sobre la API v1', () => {
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'app', 'console', 'customers-panel.tsx'), 'utf8');
  assert.match(consoleClient, /label: 'Clientes'/);
  assert.match(consoleClient, /active === 'Clientes'/);
  assert.match(panel, /\/api\/v1\/customers/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /finance\.write/);
});
