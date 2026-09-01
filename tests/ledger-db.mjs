import assert from 'node:assert/strict';
import postgres from 'postgres';
import { postgresClientOptions, resolvePostgresUrl } from '../db/postgres-connection.mjs';

const databaseUrl = resolvePostgresUrl({ preferDirect: true });
const sql = postgres(databaseUrl, postgresClientOptions(databaseUrl, { max: 1 }));

async function expectDatabaseRejection(work, pattern) {
  await assert.rejects(() => sql.begin(work), pattern);
}

try {
  const [organization] = await sql`SELECT id FROM organizations ORDER BY created_at LIMIT 1`;
  assert.ok(organization, 'Se requiere una organización migrada para la prueba de integración.');
  const accounts = await sql`
    SELECT id, currency, purpose
    FROM financial_accounts
    WHERE organization_id = ${organization.id}
  `;
  const arsSettlement = accounts.find((account) => account.currency === 'ARS' && account.purpose === 'settlement');
  const arsCustomer = accounts.find((account) => account.currency === 'ARS' && account.purpose === 'customer_funds');
  const usdCustomer = accounts.find((account) => account.currency === 'USD' && account.purpose === 'customer_funds');
  assert.ok(arsSettlement && arsCustomer && usdCustomer, 'Faltan cuentas núcleo ARS/USD.');

  const [before] = await sql`
    SELECT
      (SELECT COUNT(*) FROM ledger_journals)::int AS journals,
      (SELECT COUNT(*) FROM ledger_postings)::int AS postings,
      (SELECT COUNT(*) FROM transactions)::int AS transactions
  `;

  await expectDatabaseRejection(async (transaction) => {
    const journalId = crypto.randomUUID();
    const now = new Date().toISOString();
    await transaction`
      INSERT INTO ledger_journals
        (id, organization_id, idempotency_key, kind, description, currency, status, posted_at, created_at)
      VALUES
        (${journalId}, ${organization.id}, ${`qa-unbalanced-${journalId}`}, 'qa', 'Debe fallar', 'ARS', 'posted', ${now}, ${now})
    `;
    await transaction`
      INSERT INTO ledger_postings
        (id, organization_id, journal_id, account_id, direction, amount_minor, currency, created_at)
      VALUES
        (${crypto.randomUUID()}, ${organization.id}, ${journalId}, ${arsSettlement.id}, 'debit', 100, 'ARS', ${now})
    `;
  }, /unbalanced|crosses tenant\/currency boundaries/);

  await expectDatabaseRejection(async (transaction) => {
    const journalId = crypto.randomUUID();
    const now = new Date().toISOString();
    await transaction`
      INSERT INTO ledger_journals
        (id, organization_id, idempotency_key, kind, description, currency, status, posted_at, created_at)
      VALUES
        (${journalId}, ${organization.id}, ${`qa-crossing-${journalId}`}, 'qa', 'Debe fallar', 'ARS', 'posted', ${now}, ${now})
    `;
    await transaction`
      INSERT INTO ledger_postings
        (id, organization_id, journal_id, account_id, direction, amount_minor, currency, created_at)
      VALUES
        (${crypto.randomUUID()}, ${organization.id}, ${journalId}, ${arsSettlement.id}, 'debit', 100, 'ARS', ${now}),
        (${crypto.randomUUID()}, ${organization.id}, ${journalId}, ${usdCustomer.id}, 'credit', 100, 'ARS', ${now})
    `;
  }, /crosses tenant\/currency boundaries/);

  await expectDatabaseRejection(async (transaction) => {
    await transaction`
      UPDATE ledger_postings SET amount_minor = amount_minor
      WHERE id = (SELECT id FROM ledger_postings ORDER BY created_at LIMIT 1)
    `;
  }, /immutable/);

  const legacyId = crypto.randomUUID();
  await assert.rejects(() => sql.begin(async (transaction) => {
    const now = new Date().toISOString();
    await transaction`
      INSERT INTO transactions
        (id, organization_id, idempotency_key, type, counterparty, description, amount, currency, status, risk_score, created_at)
      VALUES
        (${legacyId}, ${organization.id}, ${`qa-legacy-${legacyId}`}, 'debit', 'QA', 'Compatibilidad', -12.34, 'ARS', 'pending', 1, ${now})
    `;
    const [stored] = await transaction`
      SELECT amount_minor::text AS amount_minor, updated_at FROM transactions WHERE id = ${legacyId}
    `;
    assert.equal(stored.amount_minor, '-1234');
    assert.equal(stored.updated_at, now);
    throw new Error('rollback intencional');
  }), /rollback intencional/);

  const [after] = await sql`
    SELECT
      (SELECT COUNT(*) FROM ledger_journals)::int AS journals,
      (SELECT COUNT(*) FROM ledger_postings)::int AS postings,
      (SELECT COUNT(*) FROM transactions)::int AS transactions
  `;
  assert.deepEqual(after, before, 'Las pruebas transaccionales no deben dejar datos residuales.');
  console.log(JSON.stringify({ ok: true, checks: ['balance', 'currency-boundary', 'immutability', 'legacy-rollout'], residualData: false }));
} finally {
  await sql.end();
}
