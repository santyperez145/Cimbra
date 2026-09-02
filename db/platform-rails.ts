import { evaluateLiveReadiness, GO_LIVE_STAGES, type ProductStatus } from '@/app/lib/platform/live-readiness';
import {
  isRailConnectionStatus, OFFICIAL_RAIL_CONNECTIONS, type OfficialRailOverride, type RailConnectionStatus,
} from '@/app/lib/platform/official-rails';
import { PlatformRailError } from '@/app/lib/platform/operating-mode';
import {
  assertSponsorBankTransition, emptyOfficialRailEvidence, mergeRailEvidence,
  normalizeOfficialRailPatch, parseDueDiligenceJson, SPONSOR_BANK_CANDIDATES, SPONSOR_DUE_DILIGENCE_CHECKS,
  type OfficialRailEvidence,
} from '@/app/lib/platform/sponsor-bank';
import { getDatabase } from './runtime';

function isProductStatus(value: string): value is ProductStatus {
  return (GO_LIVE_STAGES as readonly string[]).includes(value);
}

type OfficialRailRow = {
  id: string;
  status: string;
  evidence_note: string;
  counterparty_legal_name: string;
  counterparty_tax_id: string;
  contract_reference: string;
  safeguarding_account_ref: string;
  due_diligence_json: string;
  created_at: string;
  updated_at: string;
};

function rowEvidence(row: OfficialRailRow): OfficialRailEvidence {
  return {
    evidenceNote: row.evidence_note ?? '',
    counterpartyLegalName: row.counterparty_legal_name ?? '',
    counterpartyTaxId: row.counterparty_tax_id ?? '',
    contractReference: row.contract_reference ?? '',
    safeguardingAccountRef: row.safeguarding_account_ref ?? '',
    dueDiligence: parseDueDiligenceJson(row.due_diligence_json),
  };
}

export async function listProductStatusOverrides() {
  const rows = await getDatabase().prepare('SELECT id, status FROM platform_rails').all<{ id: string; status: string }>();
  return rows.results.filter((row): row is { id: string; status: ProductStatus } => isProductStatus(row.status));
}

export async function listOfficialRailOverrides(): Promise<OfficialRailOverride[]> {
  const rows = await getDatabase().prepare(
    `SELECT id, status, evidence_note, counterparty_legal_name, counterparty_tax_id,
            contract_reference, safeguarding_account_ref, due_diligence_json, created_at, updated_at
     FROM official_rail_connections`,
  ).all<OfficialRailRow>();
  return rows.results.flatMap((row) => {
    if (!isRailConnectionStatus(row.status)) return [];
    return [{ id: row.id, status: row.status, evidence: rowEvidence(row) }];
  });
}

export async function getOfficialRailOverride(id: string) {
  const row = await getDatabase().prepare(
    `SELECT id, status, evidence_note, counterparty_legal_name, counterparty_tax_id,
            contract_reference, safeguarding_account_ref, due_diligence_json, created_at, updated_at
     FROM official_rail_connections WHERE id = ?`,
  ).bind(id).first<OfficialRailRow>();
  if (!row || !isRailConnectionStatus(row.status)) return null;
  return { id: row.id, status: row.status as RailConnectionStatus, evidence: rowEvidence(row), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function platformLiveReadiness() {
  return evaluateLiveReadiness(await listProductStatusOverrides(), await listOfficialRailOverrides());
}

export async function listOfficialRailsForOps() {
  const readiness = await platformLiveReadiness();
  const catalogIds = new Set(OFFICIAL_RAIL_CONNECTIONS.map((rail) => rail.id));
  return {
    rails: readiness.rails.filter((rail) => catalogIds.has(rail.id)),
    sponsorCandidates: SPONSOR_BANK_CANDIDATES,
    dueDiligenceCatalog: SPONSOR_DUE_DILIGENCE_CHECKS,
    fintechPath: readiness.fintechPath,
  };
}

export async function updateOfficialRailConnection(
  id: string,
  body: Record<string, unknown> | null,
) {
  const definition = OFFICIAL_RAIL_CONNECTIONS.find((rail) => rail.id === id);
  if (!definition) {
    throw new PlatformRailError('Riel oficial desconocido.', 404, 'rail_not_found');
  }
  const patch = normalizeOfficialRailPatch(body);
  if (!patch) {
    throw new PlatformRailError('Payload de riel inválido.', 400, 'invalid_rail_patch');
  }

  const existing = await getOfficialRailOverride(id);
  const currentStatus = existing?.status ?? 'unwired';
  const currentEvidence = existing?.evidence ?? emptyOfficialRailEvidence();
  const nextEvidence = mergeRailEvidence(currentEvidence, patch);
  const nextStatus = patch.status ?? currentStatus;

  if (id === 'sponsor_bank') {
    const error = assertSponsorBankTransition(currentStatus, nextStatus, nextEvidence);
    if (error) throw new PlatformRailError(error, 422, 'sponsor_transition_blocked');
  } else if (patch.status && patch.status !== currentStatus) {
    const order = ['unwired', 'negotiating', 'contracted', 'certified', 'live'] as const;
    const from = order.indexOf(currentStatus as typeof order[number]);
    const to = order.indexOf(patch.status);
    if (from < 0 || to < 0 || Math.abs(to - from) > 1) {
      throw new PlatformRailError(`Transición inválida de ${currentStatus} a ${patch.status}.`, 422, 'rail_transition_blocked');
    }
  }

  const now = new Date().toISOString();
  const createdAt = existing?.createdAt ?? now;
  await getDatabase().prepare(
    `INSERT INTO official_rail_connections (
       id, status, evidence_note, counterparty_legal_name, counterparty_tax_id,
       contract_reference, safeguarding_account_ref, due_diligence_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       status = excluded.status,
       evidence_note = excluded.evidence_note,
       counterparty_legal_name = excluded.counterparty_legal_name,
       counterparty_tax_id = excluded.counterparty_tax_id,
       contract_reference = excluded.contract_reference,
       safeguarding_account_ref = excluded.safeguarding_account_ref,
       due_diligence_json = excluded.due_diligence_json,
       updated_at = excluded.updated_at`,
  ).bind(
    id,
    nextStatus,
    nextEvidence.evidenceNote,
    nextEvidence.counterpartyLegalName,
    nextEvidence.counterpartyTaxId,
    nextEvidence.contractReference,
    nextEvidence.safeguardingAccountRef,
    JSON.stringify(nextEvidence.dueDiligence),
    createdAt,
    now,
  ).run();

  return getOfficialRailOverride(id);
}

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export async function assertSandboxLedgerOrCertifiedRail(productId: string, ErrorType: StatusErrorConstructor = PlatformRailError) {
  const readiness = await platformLiveReadiness();
  if (readiness.effectiveMode === 'sandbox') return;
  const product = readiness.products.find((item) => item.id === productId);
  if (product?.status !== 'go_live') {
    throw new ErrorType('Este producto no completó homologación ni Go Live.', 422, 'product_not_homologated');
  }
  if (product.missingOfficialRails.length > 0) {
    throw new ErrorType('Este producto no tiene cableados los rieles oficiales (banco, cámara, esquema o sponsor).', 422, 'rail_not_wired');
  }
  if (!product.adapterReady) {
    throw new ErrorType('No hay adaptador registrado para los rieles oficiales de este producto.', 422, 'rail_adapter_missing');
  }
}
