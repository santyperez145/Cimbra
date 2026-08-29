import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sdkPackage = JSON.parse(readFileSync(join(root, 'packages', 'sdk', 'package.json'), 'utf8'));
const outputDirectory = join(root, 'public', 'sdk');
const fileName = `cimbra-sdk-${sdkPackage.version}.tgz`;
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error('sdk:artifact debe ejecutarse desde npm para localizar npm-cli.js.');

mkdirSync(outputDirectory, { recursive: true });
execFileSync(process.execPath, [npmCli, 'pack', '--workspace', '@cimbra/sdk', '--pack-destination', outputDirectory], {
  cwd: root,
  stdio: 'inherit',
});

const artifact = readFileSync(join(outputDirectory, fileName));
const checksum = createHash('sha256').update(artifact).digest('hex');
writeFileSync(join(outputDirectory, `cimbra-sdk-${sdkPackage.version}.sha256`), `${checksum}  ${fileName}\n`);
console.log(JSON.stringify({ artifact: `/sdk/${fileName}`, sha256: checksum, bytes: artifact.length }));
