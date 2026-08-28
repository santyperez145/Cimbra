import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currencyExponent,
  majorToMinor,
  minorToMajorString,
  normalizeCurrency,
} from '../app/lib/ledger/money.ts';

test('normaliza únicamente monedas soportadas', () => {
  assert.equal(normalizeCurrency('ars'), 'ARS');
  assert.equal(normalizeCurrency('PEN'), 'PEN');
  assert.equal(normalizeCurrency('EUR'), null);
});

test('convierte unidades mayores a menores sin punto flotante', () => {
  assert.equal(majorToMinor('123456789.09', 'ARS'), 12_345_678_909n);
  assert.equal(majorToMinor('10.5', 'USD'), 1_050n);
  assert.equal(majorToMinor('900', 'CLP'), 900n);
});

test('rechaza precisión incompatible con la moneda', () => {
  assert.throws(() => majorToMinor('1.001', 'ARS'), /2 decimales/);
  assert.throws(() => majorToMinor('1.5', 'CLP'), /0 decimales/);
  assert.throws(() => majorToMinor('-1', 'ARS'), /decimal positivo/);
  assert.equal(currencyExponent('CLP'), 0);
});

test('serializa enteros grandes y valores negativos con escala correcta', () => {
  assert.equal(minorToMajorString(12_345_678_909n, 'ARS'), '123456789.09');
  assert.equal(minorToMajorString(-48_000n, 'USD'), '-480.00');
  assert.equal(minorToMajorString(900n, 'CLP'), '900');
});
