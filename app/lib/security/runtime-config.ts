import { parseOperatingMode } from '../platform/operating-mode.ts';
import { validateEncryptionKeyConfiguration } from './secrets.ts';

const encoder = new TextEncoder();

export function validateRuntimeConfiguration() {
  validateEncryptionKeyConfiguration();
  const cronSecret = process.env.CRON_SECRET?.trim() ?? '';
  if (encoder.encode(cronSecret).byteLength < 32) {
    throw new Error('CRON_SECRET must contain at least 32 bytes.');
  }
  if (parseOperatingMode(process.env.CIMBRA_OPERATING_MODE) === null) {
    throw new Error('CIMBRA_OPERATING_MODE must be sandbox or live.');
  }
}
