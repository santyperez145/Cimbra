import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeConfiguration } from '../app/lib/security/runtime-config.ts';

const originalEncryptionKey = process.env.CIMBRA_ENCRYPTION_KEY;
const originalCronSecret = process.env.CRON_SECRET;

test.after(() => {
  if (originalEncryptionKey === undefined) delete process.env.CIMBRA_ENCRYPTION_KEY;
  else process.env.CIMBRA_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

test('la readiness exige secretos de cifrado y dispatcher con entropía suficiente', () => {
  process.env.CIMBRA_ENCRYPTION_KEY = '3ea72fc13c567057870342c6ebd34d88f58f6d80b1dba61c4be4e1c2f1406afb';
  process.env.CRON_SECRET = 'e949f1f8e5d04fcbaba93510f853da8c';
  assert.doesNotThrow(() => validateRuntimeConfiguration());

  process.env.CIMBRA_ENCRYPTION_KEY = 'not-a-key';
  assert.throws(() => validateRuntimeConfiguration(), /Invalid character|exactly 32 bytes/);

  process.env.CIMBRA_ENCRYPTION_KEY = '3ea72fc13c567057870342c6ebd34d88f58f6d80b1dba61c4be4e1c2f1406afb';
  process.env.CRON_SECRET = 'too-short';
  assert.throws(() => validateRuntimeConfiguration(), /at least 32 bytes/);
});
