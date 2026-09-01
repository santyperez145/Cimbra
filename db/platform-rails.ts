import { evaluateLiveReadiness, type RailStatus } from '@/app/lib/platform/live-readiness';
import { PlatformRailError } from '@/app/lib/platform/operating-mode';
import { getDatabase } from './runtime';

export type RailOverride = {
  id: string;
  status: RailStatus;
  evidenceRef: string | null;
  certifiedAt: string | null;
};

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export async function listRailOverrides() {
  const rows = await getDatabase().prepare(
    `SELECT id, status, evidence_ref AS "evidenceRef", certified_at AS "certifiedAt" FROM platform_rails`,
  ).all<RailOverride>();
  return rows.results;
}

export async function listRecordedEvidenceGates() {
  const rows = await getDatabase().prepare(
    'SELECT DISTINCT gate_id AS "gateId" FROM live_gate_evidence',
  ).all<{ gateId: string }>();
  return rows.results.map((row) => row.gateId);
}

export async function platformLiveReadiness() {
  const [rails, evidenceGateIds] = await Promise.all([listRailOverrides(), listRecordedEvidenceGates()]);
  return evaluateLiveReadiness(rails, evidenceGateIds);
}

export async function assertSandboxLedgerOrCertifiedRail(railId: string, ErrorType: StatusErrorConstructor = PlatformRailError) {
  const readiness = await platformLiveReadiness();
  if (readiness.effectiveMode === 'sandbox') return;
  const rail = readiness.rails.find((item) => item.id === railId);
  if (rail && (rail.status === 'certified' || rail.status === 'live')) return;
  throw new ErrorType('El riel directo no está certificado para dinero real.', 422, 'rail_not_connected');
}
