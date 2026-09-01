export const OPERATING_MODES = ['sandbox', 'live'] as const;
export type OperatingMode = typeof OPERATING_MODES[number];

export class PlatformRailError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 422, code = 'rail_not_connected') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function requestedOperatingMode(): OperatingMode {
  const value = process.env.CIMBRA_OPERATING_MODE?.trim().toLowerCase();
  return value === 'live' ? 'live' : 'sandbox';
}

export function parseOperatingMode(value: string | undefined | null): OperatingMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'sandbox' || normalized === 'live') return normalized;
  if (!normalized) return 'sandbox';
  return null;
}

export function effectiveOperatingMode(liveReady: boolean): OperatingMode {
  return requestedOperatingMode() === 'live' && liveReady ? 'live' : 'sandbox';
}
