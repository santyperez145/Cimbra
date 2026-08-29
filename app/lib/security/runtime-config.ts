import { validateEncryptionKeyConfiguration } from './secrets.ts';

const encoder = new TextEncoder();

export function validateRuntimeConfiguration() {
  validateEncryptionKeyConfiguration();
  const cronSecret = process.env.CRON_SECRET?.trim() ?? '';
  if (encoder.encode(cronSecret).byteLength < 32) {
    throw new Error('CRON_SECRET must contain at least 32 bytes.');
  }
}
