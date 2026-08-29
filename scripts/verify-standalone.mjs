import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const requiredArtifacts = [
  join(root, '.next', 'standalone', 'server.js'),
  join(root, '.next', 'standalone', '.next', 'static'),
  join(root, '.next', 'standalone', 'public', 'favicon.svg'),
];

for (const artifact of requiredArtifacts) {
  try {
    await access(artifact, constants.R_OK);
  } catch {
    throw new Error(`Missing standalone build artifact: ${artifact}`);
  }
}

console.log('Standalone runtime contract verified.');
