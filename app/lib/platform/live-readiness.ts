import {
  OPERATING_MODES, PlatformRailError, effectiveOperatingMode, requestedOperatingMode, type OperatingMode,
} from './operating-mode.ts';

export const LIVE_GATE_STATUSES = ['ready', 'missing'] as const;
export type LiveGateStatus = typeof LIVE_GATE_STATUSES[number];

export const RAIL_STATUSES = ['disconnected', 'pending_certification', 'certified', 'live'] as const;
export type RailStatus = typeof RAIL_STATUSES[number];

export const RAIL_COUNTERPARTY_KINDS = ['clearing_house', 'bank', 'card_scheme', 'official_registry', 'regulated_sponsor'] as const;
export type RailCounterpartyKind = typeof RAIL_COUNTERPARTY_KINDS[number];

export type LiveGate = {
  id: string;
  name: string;
  kind: 'software' | 'evidence' | 'rail';
  requiredForLive: boolean;
  status: LiveGateStatus;
  summary: string;
};

export type DirectRail = {
  id: string;
  country: string;
  kind: string;
  counterpartyKind: RailCounterpartyKind;
  counterparty: string;
  requiredForLiveMoney: boolean;
  status: RailStatus;
  evidenceRef: string | null;
  certifiedAt: string | null;
};

type StatusErrorConstructor = new (message: string, status?: number, code?: string) => Error;

export const DIRECT_RAILS: readonly Omit<DirectRail, 'status' | 'evidenceRef' | 'certifiedAt'>[] = [
  {
    id: 'ar_coelsa_transfers', country: 'AR', kind: 'instant_credit', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa', requiredForLiveMoney: true,
  },
  {
    id: 'ar_coelsa_debin', country: 'AR', kind: 'instant_debit', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa', requiredForLiveMoney: true,
  },
  {
    id: 'ar_coelsa_echeq', country: 'AR', kind: 'echeq_clearing', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa', requiredForLiveMoney: true,
  },
  {
    id: 'ar_cbu_directory', country: 'AR', kind: 'account_directory', counterpartyKind: 'clearing_house',
    counterparty: 'Coelsa', requiredForLiveMoney: true,
  },
  {
    id: 'ar_card_issuing', country: 'AR', kind: 'card_issuing', counterpartyKind: 'card_scheme',
    counterparty: 'Esquema o BIN sponsor regulado', requiredForLiveMoney: false,
  },
  {
    id: 'ar_card_acquiring', country: 'AR', kind: 'card_acquiring', counterpartyKind: 'card_scheme',
    counterparty: 'Esquema o adquirente regulado', requiredForLiveMoney: false,
  },
  {
    id: 'ar_biller_originators', country: 'AR', kind: 'bill_payments', counterpartyKind: 'official_registry',
    counterparty: 'Originadores y redes de cobranza directos', requiredForLiveMoney: false,
  },
];

const SOFTWARE_GATES: readonly Omit<LiveGate, 'status'>[] = [
  {
    id: 'double_entry_ledger', name: 'Ledger de doble partida', kind: 'software', requiredForLive: true,
    summary: 'Journals balanceados, postings inmutables y reversas compensatorias.',
  },
  {
    id: 'tenant_isolation', name: 'Aislamiento de tenant', kind: 'software', requiredForLive: true,
    summary: 'Organizaciones, locks y constraints impiden cruzar datos o dinero entre tenants.',
  },
  {
    id: 'rbac_and_scopes', name: 'RBAC y scopes', kind: 'software', requiredForLive: true,
    summary: 'Roles humanos y API keys con mínimo privilegio, validados en servidor.',
  },
  {
    id: 'idempotency', name: 'Idempotencia', kind: 'software', requiredForLive: true,
    summary: 'Claves por organización, fingerprints y replay explícito.',
  },
  {
    id: 'audit_and_webhooks', name: 'Auditoría y webhooks', kind: 'software', requiredForLive: true,
    summary: 'Eventos durables, firma HMAC y outbox transaccional.',
  },
  {
    id: 'versioned_public_api', name: 'API versionada', kind: 'software', requiredForLive: true,
    summary: 'Contrato OpenAPI, SDK y header Cimbra-Version.',
  },
  {
    id: 'fail_closed_rail_ports', name: 'Puertos de riel fail-closed', kind: 'software', requiredForLive: true,
    summary: 'Dinero externo exige riel certificado; sin él el modo live no se activa.',
  },
];

const EVIDENCE_GATES: readonly Omit<LiveGate, 'status'>[] = [
  {
    id: 'license_or_sponsor', name: 'Licencia o sponsor', kind: 'evidence', requiredForLive: true,
    summary: 'Licencia aplicable o contrato de sponsor regulado para la jurisdicción inicial.',
  },
  {
    id: 'safeguarding', name: 'Safeguarding', kind: 'evidence', requiredForLive: true,
    summary: 'Segregación y custodia de fondos de clientes según el marco local.',
  },
  {
    id: 'three_way_reconciliation', name: 'Conciliación de tres vías', kind: 'evidence', requiredForLive: true,
    summary: 'Extractos oficiales Cimbra / banco o cámara / settlement, con excepciones en SLA.',
  },
  {
    id: 'pentest_closed', name: 'Pentest cerrado', kind: 'evidence', requiredForLive: true,
    summary: 'Hallazgos críticos y altos cerrados antes de mover fondos.',
  },
  {
    id: 'slo_90d', name: 'SLO medidos 90 días', kind: 'evidence', requiredForLive: true,
    summary: 'Disponibilidad y latencia medidas en el entorno que va a liquidar.',
  },
  {
    id: 'incident_response', name: 'Respuesta a incidentes', kind: 'evidence', requiredForLive: true,
    summary: 'On-call, runbooks, backups y plan de reversas para dinero real.',
  },
  {
    id: 'legal_terms_dpa', name: 'Términos y DPA', kind: 'evidence', requiredForLive: true,
    summary: 'Términos, privacidad, DPA y matriz regulatoria aprobados.',
  },
  {
    id: 'certified_direct_rail', name: 'Riel directo certificado', kind: 'rail', requiredForLive: true,
    summary: 'Al menos un riel de dinero con banco, cámara, esquema o sponsor homologado. No competidores.',
  },
];

function isCertifiedRail(status: RailStatus) {
  return status === 'certified' || status === 'live';
}

export function materializeRails(overrides: ReadonlyArray<{ id: string; status: RailStatus; evidenceRef: string | null; certifiedAt: string | null }> = []): DirectRail[] {
  const byId = new Map(overrides.map((row) => [row.id, row]));
  return DIRECT_RAILS.map((rail) => {
    const overlay = byId.get(rail.id);
    return {
      ...rail,
      status: overlay?.status ?? 'disconnected',
      evidenceRef: overlay?.evidenceRef ?? null,
      certifiedAt: overlay?.certifiedAt ?? null,
    };
  });
}

export function evaluateLiveReadiness(
  overrides: ReadonlyArray<{ id: string; status: RailStatus; evidenceRef: string | null; certifiedAt: string | null }> = [],
  evidenceGateIds: readonly string[] = [],
) {
  const rails = materializeRails(overrides);
  const moneyRailReady = rails.some((rail) => rail.requiredForLiveMoney && isCertifiedRail(rail.status));
  const recorded = new Set(evidenceGateIds);
  const gates: LiveGate[] = [
    ...SOFTWARE_GATES.map((gate) => ({ ...gate, status: 'ready' as const })),
    ...EVIDENCE_GATES.map((gate) => ({
      ...gate,
      status: gate.id === 'certified_direct_rail'
        ? (moneyRailReady ? 'ready' as const : 'missing' as const)
        : (recorded.has(gate.id) ? 'ready' as const : 'missing' as const),
    })),
  ];
  const missingRequired = gates.filter((gate) => gate.requiredForLive && gate.status !== 'ready');
  const liveReady = missingRequired.length === 0 && moneyRailReady;
  const requestedMode = requestedOperatingMode();
  const effectiveMode = effectiveOperatingMode(liveReady);
  return {
    requestedMode,
    effectiveMode,
    liveReady,
    liveBlocked: requestedMode === 'live' && !liveReady,
    blockReason: requestedMode === 'live' && !liveReady
      ? 'live_gates_unmet'
      : liveReady ? null : 'sandbox_environment',
    modes: OPERATING_MODES,
    gates,
    rails,
    summary: {
      readyGates: gates.filter((gate) => gate.status === 'ready').length,
      missingGates: missingRequired.length,
      disconnectedRails: rails.filter((rail) => rail.status === 'disconnected').length,
      certifiedRails: rails.filter((rail) => isCertifiedRail(rail.status)).length,
    },
  };
}

export type LiveReadiness = ReturnType<typeof evaluateLiveReadiness>;

export function currentOperatingMode(
  overrides?: Parameters<typeof evaluateLiveReadiness>[0],
  evidenceGateIds?: Parameters<typeof evaluateLiveReadiness>[1],
): OperatingMode {
  return evaluateLiveReadiness(overrides, evidenceGateIds).effectiveMode;
}

export function requireSandboxLedgerOrCertifiedRail(railId: string, ErrorType: StatusErrorConstructor = PlatformRailError) {
  const readiness = evaluateLiveReadiness();
  if (readiness.effectiveMode === 'sandbox') return;
  const rail = readiness.rails.find((item) => item.id === railId);
  if (rail && isCertifiedRail(rail.status)) return;
  throw new ErrorType('El riel directo no está certificado para dinero real.', 422, 'rail_not_connected');
}

export function requireLiveApiKeysEnabled() {
  if (!evaluateLiveReadiness().liveReady) {
    throw new PlatformRailError('Las API keys live no están habilitadas hasta completar los gates de producción.', 403, 'live_environment_disabled');
  }
}
