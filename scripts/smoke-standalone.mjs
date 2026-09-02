import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { once } from 'node:events';

const root = process.cwd();
const runtimeRoot = join(root, '.next', 'standalone');
const serverPath = join(runtimeRoot, 'server.js');

await access(serverPath);

const port = await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', () => {
    const address = reservation.address();
    if (!address || typeof address === 'string') {
      reservation.close();
      reject(new Error('Could not reserve a local port for the standalone smoke test.'));
      return;
    }
    reservation.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const baseEnv = { ...process.env };
delete baseEnv.DATABASE_URL;
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: runtimeRoot,
  env: {
    ...baseEnv,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    CIMBRA_PUBLIC_URL: origin,
    NEXT_PUBLIC_CIMBRA_PUBLIC_URL: origin,
    CIMBRA_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    CRON_SECRET: randomBytes(32).toString('hex'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-6000);
  });
}

async function stopChild() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function fetchRequired(path) {
  return new Promise((resolve, reject) => {
    const request = get(`${origin}${path}`, { agent: false }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${path} returned HTTP ${response.statusCode ?? 'unknown'}.`));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.setTimeout(2_000, () => request.destroy(new Error(`${path} timed out.`)));
    request.once('error', reject);
  });
}

try {
  let html;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Standalone server exited with code ${child.exitCode}.`);
    try {
      html = await fetchRequired('/terms');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (!html) throw new Error('Standalone server did not become ready within 20 seconds.');
  if (!html.includes('Términos de uso')) throw new Error('The standalone response did not render the expected route.');

  const investors = await fetchRequired('/investors');
  if (!investors.includes('DATA ROOM PÚBLICO') || !investors.includes('USD 500')) {
    throw new Error('The investors data room did not render the Gate 1 envelope.');
  }
  const help = await fetchRequired('/help');
  if (!help.includes('CENTRO DE AYUDA') || !help.includes('Cómo abrir un caso')) {
    throw new Error('The public help center did not render.');
  }
  const status = await fetchRequired('/status');
  if (!status.includes('STATUS PÚBLICO') || !status.includes('servicios de dominio')) {
    throw new Error('The public status page did not render the service topology.');
  }

  const assetPath = html.match(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/)?.[1];
  if (!assetPath) throw new Error('The standalone response did not reference a Next.js static asset.');

  await fetchRequired(assetPath);
  await fetchRequired('/favicon.svg');
  console.log(`Standalone runtime smoke passed on port ${port}: HTML, Next.js assets and public assets are served.`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`${detail}\nStandalone server output:\n${output || '(no output)'}`);
} finally {
  await stopChild();
}
