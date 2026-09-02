import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  KERNEL_CONTRACT_TABLES, SERVICE_CATALOG, isExtractable, serviceTopology, tableOwner,
} from '../app/lib/platform/service-catalog.ts';
import { WEBHOOK_EVENT_TYPES } from '../app/lib/platform/webhook-events.ts';

const root = process.cwd();

function schemaTables() {
  const source = readFileSync(join(root, 'db', 'schema.ts'), 'utf8');
  return [...source.matchAll(/pgTable\('([a-z_]+)'/g)].map((match) => match[1]);
}

function writtenTables(modulePath: string) {
  const source = readFileSync(join(root, modulePath), 'utf8');
  const tables = new Set<string>();
  for (const match of source.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)) tables.add(match[1]);
  for (const match of source.matchAll(/UPDATE\s+([a-z_]+)\s+SET/gi)) tables.add(match[1]);
  for (const match of source.matchAll(/DELETE\s+FROM\s+([a-z_]+)/gi)) tables.add(match[1]);
  return [...tables].sort();
}

function dataAccessModules() {
  const roots = ['db', 'app'];
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(relative);
        continue;
      }
      if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
      if (writtenTables(relative).length > 0) found.push(relative);
    }
  };
  for (const directory of roots) walk(directory);
  return found.sort();
}

test('cada tabla pertenece a exactamente un servicio', () => {
  const tables = schemaTables();
  const owned = SERVICE_CATALOG.flatMap((service) => service.ownedTables);
  const duplicated = owned.filter((table, index) => owned.indexOf(table) !== index);
  assert.deepEqual(duplicated, [], 'hay tablas reclamadas por más de un servicio');
  const missing = tables.filter((table) => !owned.includes(table));
  assert.deepEqual(missing, [], 'hay tablas del esquema sin servicio propietario');
  const orphan = owned.filter((table) => !tables.includes(table));
  assert.deepEqual(orphan, [], 'hay tablas declaradas que no existen en el esquema');
});

test('cada módulo que escribe datos pertenece a exactamente un servicio', () => {
  const modules = dataAccessModules();
  const declared = SERVICE_CATALOG.flatMap((service) => service.modules);
  const duplicated = declared.filter((module, index) => declared.indexOf(module) !== index);
  assert.deepEqual(duplicated, [], 'hay módulos reclamados por más de un servicio');
  const missing = modules.filter((module) => !declared.includes(module));
  assert.deepEqual(missing, [], 'hay módulos que escriben datos sin servicio declarado');
  const stale = declared.filter((module) => !existsSync(join(root, module)));
  assert.deepEqual(stale, [], 'hay módulos declarados que ya no existen');
});

test('ningún servicio escribe tablas ajenas fuera del contrato del kernel o de su deuda declarada', () => {
  const violations: string[] = [];
  for (const service of SERVICE_CATALOG) {
    const allowed = new Set<string>([
      ...service.ownedTables,
      ...KERNEL_CONTRACT_TABLES,
      ...service.extractionDebt.map((debt) => debt.table),
    ]);
    for (const modulePath of service.modules) {
      for (const table of writtenTables(modulePath)) {
        if (!allowed.has(table)) violations.push(`${service.id} escribe ${table} desde ${modulePath} sin declararlo`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('la deuda de extracción declarada refleja escrituras reales y nombra al propietario correcto', () => {
  const problems: string[] = [];
  for (const service of SERVICE_CATALOG) {
    const written = new Set(service.modules.flatMap((module) => writtenTables(module)));
    for (const debt of service.extractionDebt) {
      if (!written.has(debt.table)) problems.push(`${service.id} declara deuda sobre ${debt.table} pero ya no la escribe`);
      if (service.ownedTables.includes(debt.table)) problems.push(`${service.id} declara deuda sobre ${debt.table} siendo su propietario`);
      const owner = tableOwner(debt.table);
      if (owner !== debt.owner) problems.push(`${service.id} atribuye ${debt.table} a ${debt.owner} pero pertenece a ${owner}`);
      assert.ok(debt.reason.length > 20, `la deuda de ${service.id} sobre ${debt.table} necesita una razón explícita`);
    }
  }
  assert.deepEqual(problems, []);
});

test('las superficies API declaradas existen y no se solapan entre servicios', () => {
  const surfaces = SERVICE_CATALOG.flatMap((service) => service.apiSurfaces);
  const duplicated = surfaces.filter((surface, index) => surfaces.indexOf(surface) !== index);
  assert.deepEqual(duplicated, [], 'hay superficies API reclamadas por más de un servicio');
  const missing = surfaces.filter((surface) => !existsSync(join(root, surface)));
  assert.deepEqual(missing, [], 'hay superficies API declaradas que no existen');
});

test('cada evento publicado pertenece a exactamente un servicio', () => {
  const prefixes = SERVICE_CATALOG.flatMap((service) => service.publishes);
  const duplicated = prefixes.filter((prefix, index) => prefixes.indexOf(prefix) !== index);
  assert.deepEqual(duplicated, [], 'hay prefijos de evento reclamados por más de un servicio');
  for (const prefix of prefixes) assert.match(prefix, /^[a-z_]+\.[a-z_]*$/);
  const unowned = WEBHOOK_EVENT_TYPES.filter((type) => prefixes.filter((prefix) => type.startsWith(prefix)).length !== 1);
  assert.deepEqual(unowned, [], 'hay eventos sin servicio propietario único');
  const unused = prefixes.filter((prefix) => !WEBHOOK_EVENT_TYPES.some((type) => type.startsWith(prefix)));
  assert.deepEqual(unused, [], 'hay prefijos declarados que ningún evento usa');
});

test('el catálogo declara identidad, misión, compuerta de extracción y comparación por servicio', () => {
  const ids = SERVICE_CATALOG.map((service) => service.id);
  assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  for (const service of SERVICE_CATALOG) {
    assert.match(service.id, /^[a-z][a-z-]+$/);
    assert.ok(service.mission.length > 30, `${service.id} necesita una misión explícita`);
    assert.ok(service.extractionGate.length > 40, `${service.id} necesita una compuerta de extracción explícita`);
    assert.ok(service.benchmark.length > 40, `${service.id} necesita una comparación con el mercado`);
    assert.ok(service.ownedTables.length > 0, `${service.id} necesita datos propios`);
    assert.ok(service.modules.length > 0, `${service.id} necesita al menos un módulo`);
  }
});

test('la topología reporta la deuda agregada y ningún servicio se declara desplegado por separado sin serlo', () => {
  const topology = serviceTopology();
  assert.equal(topology.totals.services, SERVICE_CATALOG.length);
  assert.equal(topology.totals.ownedTables, schemaTables().length);
  assert.equal(topology.totals.standalone, 0, 'no hay servicios en runtime propio hasta autorizar el gasto de infraestructura');
  assert.equal(
    topology.totals.extractable,
    SERVICE_CATALOG.filter((service) => isExtractable(service)).length,
  );
  assert.equal(
    topology.totals.extractionDebt,
    SERVICE_CATALOG.reduce((total, service) => total + service.extractionDebt.length, 0),
  );
});
