import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

export function isPrivateAddress(rawAddress: string) {
  const address = rawAddress.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) !== 6) return true;
  if (address.startsWith('::ffff:')) return privateIpv4(address.slice(7));
  return address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd') ||
    /^fe[89ab]/.test(address) || address.startsWith('ff') || address.startsWith('2001:db8:');
}

export function normalizeWebhookUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('La URL del webhook es inválida.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('La URL del webhook es inválida.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('El webhook debe usar HTTPS, puerto 443 y no incluir credenciales.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('El webhook debe usar un host público.');
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) throw new Error('El webhook no puede apuntar a una red privada o reservada.');
  url.hash = '';
  return url.toString();
}

export async function assertPublicWebhookDestination(value: string) {
  const normalized = normalizeWebhookUrl(value);
  const url = new URL(normalized);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('El host del webhook no resuelve exclusivamente a direcciones públicas.');
  }
  return normalized;
}
