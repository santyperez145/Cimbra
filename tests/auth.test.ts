import assert from 'node:assert/strict';
import test from 'node:test';
import { mutationAllowed } from '../app/lib/auth/http.ts';
import {
  createRecoveryCode, createTotpSecret, decodeBase32, encodeBase32, normalizeRecoveryCode,
  recoveryCodeHash, totpCode, totpProvisioningUri, verifyTotp,
} from '../app/lib/auth/totp.ts';

test('acepta el origen del host local aunque CIMBRA_PUBLIC_URL apunte a producción', () => {
  const previous = process.env.CIMBRA_PUBLIC_URL;
  process.env.CIMBRA_PUBLIC_URL = 'https://cimbra-rose.vercel.app';
  try {
    const local = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', Host: 'localhost:3000' },
    });
    assert.equal(mutationAllowed(local), true);

    const loopback = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:3000', Host: '127.0.0.1:3000' },
    });
    assert.equal(mutationAllowed(loopback), true);

    const configured = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://cimbra-rose.vercel.app' },
    });
    assert.equal(mutationAllowed(configured), true);

    const evil = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(mutationAllowed(evil), false);

    const spoofed = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Host: 'localhost:3000' },
    });
    assert.equal(mutationAllowed(spoofed), false);
  } finally {
    if (previous === undefined) delete process.env.CIMBRA_PUBLIC_URL;
    else process.env.CIMBRA_PUBLIC_URL = previous;
  }
});

test('implementa los vectores RFC 6238 para SHA-1', async () => {
  const secret = encodeBase32(new TextEncoder().encode('12345678901234567890'));
  const vectors = [
    [59_000, '94287082'], [1_111_111_109_000, '07081804'], [1_111_111_111_000, '14050471'],
    [1_234_567_890_000, '89005924'], [2_000_000_000_000, '69279037'], [20_000_000_000_000, '65353130'],
  ] as const;
  for (const [timestamp, expected] of vectors) {
    assert.equal(await totpCode(secret, BigInt(Math.floor(timestamp / 30_000)), 8), expected);
  }
});

test('acepta TOTP actual con una ventana y rechaza códigos inválidos', async () => {
  const secret = createTotpSecret();
  assert.equal(decodeBase32(secret).length, 20);
  const timestamp = 1_787_942_400_000;
  const currentStep = BigInt(Math.floor(timestamp / 30_000));
  const code = await totpCode(secret, currentStep);
  assert.equal(await verifyTotp(secret, code, { timestamp }), currentStep);
  assert.equal(await verifyTotp(secret, '00000x', { timestamp }), null);
  assert.match(totpProvisioningUri(secret, 'owner@cimbra.com'), /^otpauth:\/\/totp\/Cimbra%3Aowner%40cimbra.com\?/);
});

test('genera recovery codes de 80 bits y los hashea de forma normalizada', async () => {
  const code = createRecoveryCode();
  assert.match(code, /^[A-F0-9]{5}(?:-[A-F0-9]{5}){3}$/);
  assert.equal(normalizeRecoveryCode(code).length, 20);
  assert.equal(await recoveryCodeHash(code), await recoveryCodeHash(code.toLowerCase().replaceAll('-', ' ')));
});
