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

test('la landing publica capacidades reales del sandbox sin inventar rieles', () => {
  const page = readFileSync(join(root, 'app', 'page.tsx'), 'utf8');
  assert.match(page, /194 operaciones/);
  assert.match(page, /Pagos AR y cobranzas/);
  assert.match(page, /Live fail-closed/);
  assert.match(page, /Sin Coelsa, DEBIN ni QR de red/);
  assert.doesNotMatch(page, /QR interoperable/);
  assert.doesNotMatch(page, /Tarjeta corporativa/);
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

test('la consola opera movimientos sobre la API de transferencias', () => {
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'app', 'console', 'transfers-panel.tsx'), 'utf8');
  assert.match(consoleClient, /label: 'Movimientos'/);
  assert.match(consoleClient, /<TransfersPanel role=\{role\} refreshKey=\{refreshKey\} \/>/);
  assert.match(panel, /\/api\/v1\/transfers/);
  assert.match(panel, /\/reverse/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /cimbra-movimientos\.csv/);
});

test('la consola opera book transfers, cash-in/out y ledger sobre APIs v1 con RBAC', () => {
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const book = readFileSync(join(root, 'app', 'console', 'book-transfers-panel.tsx'), 'utf8');
  const payments = readFileSync(join(root, 'app', 'console', 'payments-panel.tsx'), 'utf8');
  const ledger = readFileSync(join(root, 'app', 'console', 'ledger-panel.tsx'), 'utf8');
  assert.match(consoleClient, /label: 'Book transfers'/);
  assert.match(consoleClient, /label: 'Cash-in\/out'/);
  assert.match(consoleClient, /label: 'Ledger'/);
  assert.match(consoleClient, /active === 'Book transfers'/);
  assert.match(consoleClient, /active === 'Cash-in\/out'/);
  assert.match(consoleClient, /active === 'Ledger'/);
  assert.match(book, /\/api\/v1\/book-transfers/);
  assert.match(book, /Idempotency-Key/);
  assert.match(book, /finance\.write/);
  assert.match(payments, /\/api\/v1\/payments/);
  assert.match(payments, /\/api\/v1\/payments\/\$\{item\.transactionId\}\/reverse/);
  assert.match(payments, /\/api\/v1\/ledger/);
  assert.match(payments, /Idempotency-Key/);
  assert.match(payments, /finance\.write/);
  assert.match(payments, /Revertir/);
  assert.match(ledger, /\/api\/v1\/ledger/);
  assert.match(ledger, /\/api\/v1\/holds\//);
  assert.match(ledger, /risk\.cases\.resolve/);
  assert.match(ledger, /method: 'POST'/);
  assert.doesNotMatch(ledger, /ledger\/entries/);
});

test('ops registra el envelope Gate 1 sin abrir liveReady', () => {
  const ops = readFileSync(join(root, 'app', 'ops', 'ops-client.tsx'), 'utf8');
  const capitalRoute = readFileSync(join(root, 'app', 'api', 'ops', 'capital', 'route.ts'), 'utf8');
  const capitalPatch = readFileSync(join(root, 'app', 'api', 'ops', 'capital', '[id]', 'route.ts'), 'utf8');
  const overview = readFileSync(join(root, 'app', 'api', 'ops', 'overview', 'route.ts'), 'utf8');
  assert.match(ops, /Capital Gate 1/);
  assert.match(ops, /\/api\/ops\/capital\//);
  assert.match(ops, /Marcar gastado/);
  assert.match(ops, /Gastar no habilita liveReady/);
  assert.match(capitalRoute, /platformCapitalPlan/);
  assert.match(capitalPatch, /updateCapitalAllocation/);
  assert.match(overview, /platformCapitalPlan/);
  assert.match(overview, /capital,/);
});

test('abrir cuentas exige KYC/KYB aprobado y la consola no simula payments', () => {
  const accountsRoute = readFileSync(join(root, 'app', 'api', 'sandbox', 'accounts', 'route.ts'), 'utf8');
  const dueDiligence = readFileSync(join(root, 'db', 'due-diligence.ts'), 'utf8');
  const wallets = readFileSync(join(root, 'db', 'wallets.ts'), 'utf8');
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const capabilities = readFileSync(join(root, 'app', 'lib', 'platform', 'capabilities.ts'), 'utf8');
  assert.match(dueDiligence, /assertCustomerDueDiligenceApproved/);
  assert.match(dueDiligence, /customer_kyc_required/);
  assert.match(accountsRoute, /assertCustomerDueDiligenceApproved/);
  assert.match(wallets, /assertCustomerDueDiligenceApproved/);
  assert.doesNotMatch(consoleClient, /paymentOpen/);
  assert.doesNotMatch(consoleClient, /Simulá una transferencia/);
  assert.match(consoleClient, /setActive\('Riesgo'\)/);
  assert.doesNotMatch(capabilities, /payment intents/);
  assert.doesNotMatch(capabilities, /límites, fees/);
});

test('help-center documenta Compliance, Aprobaciones y Disputas con límites honestos', () => {
  const help = readFileSync(join(root, 'app', 'lib', 'platform', 'help-center.ts'), 'utf8');
  assert.match(help, /id: 'compliance-kyc'/);
  assert.match(help, /customer_kyc_required/);
  assert.match(help, /id: 'approvals'/);
  assert.match(help, /maker\/checker/);
  assert.match(help, /id: 'disputes'/);
  assert.match(help, /crédito compensatorio/);
  assert.doesNotMatch(help, /Visa\/Mastercard live/);
});

test('identity libera asignaciones vía risk/reconcil y el alta de org vía tenants', () => {
  const access = readFileSync(join(root, 'db', 'access.ts'), 'utf8');
  const risk = readFileSync(join(root, 'db', 'risk.ts'), 'utf8');
  const reconciliation = readFileSync(join(root, 'db', 'reconciliation.ts'), 'utf8');
  const organization = readFileSync(join(root, 'db', 'organization.ts'), 'utf8');
  const catalog = readFileSync(join(root, 'app', 'lib', 'platform', 'service-catalog.ts'), 'utf8');
  assert.match(access, /clearOpenRiskCaseAssignments/);
  assert.match(access, /clearOpenReconciliationAssignments/);
  assert.match(access, /createSandboxOrganizationInTransaction/);
  assert.doesNotMatch(access, /INSERT\s+INTO\s+organizations/i);
  assert.doesNotMatch(access, /UPDATE risk_cases SET assigned_to/);
  assert.doesNotMatch(access, /UPDATE reconciliation_exceptions SET assigned_to/);
  assert.match(risk, /clearOpenRiskCaseAssignments/);
  assert.match(reconciliation, /clearOpenReconciliationAssignments/);
  assert.match(organization, /createSandboxOrganizationInTransaction/);
  assert.match(organization, /INSERT\s+INTO\s+organizations/i);
  assert.doesNotMatch(catalog, /table: 'risk_cases', owner: 'risk'/);
  assert.doesNotMatch(catalog, /table: 'reconciliation_exceptions', owner: 'reconciliation'/);
  assert.doesNotMatch(catalog, /table: 'organizations', owner: 'tenants'/);
});

test('la consola opera la auditoría del tenant sobre GET /api/v1/events', () => {
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'app', 'console', 'audit-panel.tsx'), 'utf8');
  assert.match(consoleClient, /label: 'Auditoría'/);
  assert.match(consoleClient, /active === 'Auditoría'/);
  assert.match(panel, /\/api\/v1\/events/);
  assert.match(panel, /cimbra-auditoria\.csv/);
  assert.doesNotMatch(panel, /method: 'POST'/);
});

test('la consola opera cuentas de producto sobre la API v1 y el statement', () => {
  const consoleClient = readFileSync(join(root, 'app', 'console', 'console-client.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'app', 'console', 'accounts-panel.tsx'), 'utf8');
  assert.match(consoleClient, /<AccountsPanel role=\{role\} balances=\{data\.balances\} \/>/);
  assert.match(panel, /\/api\/v1\/accounts/);
  assert.match(panel, /\/statement\?limit=50/);
  assert.match(panel, /Idempotency-Key/);
  assert.match(panel, /finance\.write/);
});
