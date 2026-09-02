export type RailConnectionStatus = 'unwired' | 'negotiating' | 'contracted' | 'certified' | 'live';

export const SPONSOR_DUE_DILIGENCE_STATUSES = ['pending', 'passed', 'failed', 'waived'] as const;
export type SponsorDueDiligenceStatus = (typeof SPONSOR_DUE_DILIGENCE_STATUSES)[number];

/** Checklist BCRA/PSPCP para banco patrocinante. No es KYC de customers. */
export const SPONSOR_DUE_DILIGENCE_CHECKS = [
  {
    id: 'sponsorship_contract',
    required: true,
    name: 'Contrato de patrocinio',
    summary: 'Contrato firmado entre la PJ argentina de Cimbra y la entidad financiera patrocinante.',
  },
  {
    id: 'sight_accounts',
    required: true,
    name: 'Cuentas a la vista',
    summary: 'Cuentas a la vista del sponsor informadas al BCRA para la figura PSPCP.',
  },
  {
    id: 'fund_restitution_modes',
    required: true,
    name: 'Modos de restitución',
    summary: 'Modos de restitución de fondos de clientes documentados y operables.',
  },
  {
    id: 'bcra_disclosure',
    required: true,
    name: 'Información al BCRA',
    summary: 'Banco(s) patrocinante(s), servicios de pago y TyC listos para la inscripción SEFyC/PSPCP.',
  },
  {
    id: 'client_fund_segregation',
    required: true,
    name: 'Segregación de fondos',
    summary: 'Cuenta de fondos de clientes distinta de la operativa de Cimbra, con conciliación de tres vías.',
  },
  {
    id: 'no_competitor_baas',
    required: true,
    name: 'Sin BaaS competidor',
    summary: 'El patrocinio no obliga a construir el producto sobre bindX, BIND PSP ni otro BaaS competidor. BIND Banco puede ser el banco; bindX no es el core.',
  },
  {
    id: 'compliance_contacts',
    required: false,
    name: 'Contactos de cumplimiento',
    summary: 'Canales de compliance y operaciones del sponsor para incidentes y pedidos BCRA.',
  },
] as const;

export type SponsorDueDiligenceCheckId = (typeof SPONSOR_DUE_DILIGENCE_CHECKS)[number]['id'];

export type SponsorDueDiligenceItem = {
  checkId: SponsorDueDiligenceCheckId;
  status: SponsorDueDiligenceStatus;
  note: string;
  updatedAt: string;
};

/**
 * Candidatos a entidad financiera patrocinante.
 * No son conectores de producto ni filas del catálogo OFFICIAL_RAIL_CONNECTIONS.
 */
export const SPONSOR_BANK_CANDIDATES = [
  {
    id: 'bind_banco_ef',
    label: 'BIND Banco (entidad financiera)',
    summary: 'Candidato regulado a banco patrocinante PSPCP y cuentas de safeguarding. Distinto de BIND PSP / bindX, que siguen siendo benchmarks de producto, no el core de Cimbra.',
    rfiTopics: [
      'Contrato de patrocinio PSPCP sin exclusividad de stack bindX',
      'Cuentas a la vista de fondos de clientes y cuenta operativa separada',
      'Costos, mínimos, SLA y ventanas de alta',
      'Información que el banco exige para due diligence de Cimbra',
      'Exit y portabilidad si se suma un segundo sponsor',
    ],
  },
  {
    id: 'other_regulated_ef_ar',
    label: 'Otra entidad financiera argentina',
    summary: 'Segundo banco regulado para diversificar patrocinio. El RFI es el mismo: patrocinio y safeguarding, no BaaS white-label.',
    rfiTopics: [
      'Disponibilidad para patrocinar un PSPCP propio',
      'Cuentas segregadas y reportes de conciliación',
      'Plazos y documentación de alta',
    ],
  },
] as const;

export type OfficialRailEvidence = {
  evidenceNote: string;
  counterpartyLegalName: string;
  counterpartyTaxId: string;
  contractReference: string;
  safeguardingAccountRef: string;
  dueDiligence: SponsorDueDiligenceItem[];
};

export function emptyOfficialRailEvidence(): OfficialRailEvidence {
  return {
    evidenceNote: '',
    counterpartyLegalName: '',
    counterpartyTaxId: '',
    contractReference: '',
    safeguardingAccountRef: '',
    dueDiligence: [],
  };
}

export function parseDueDiligenceJson(raw: string | null | undefined): SponsorDueDiligenceItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set(SPONSOR_DUE_DILIGENCE_CHECKS.map((item) => item.id));
    const statuses = new Set<string>(SPONSOR_DUE_DILIGENCE_STATUSES);
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const checkId = typeof row.checkId === 'string' ? row.checkId : '';
      const status = typeof row.status === 'string' ? row.status : '';
      if (!allowed.has(checkId as SponsorDueDiligenceCheckId) || !statuses.has(status)) return [];
      return [{
        checkId: checkId as SponsorDueDiligenceCheckId,
        status: status as SponsorDueDiligenceStatus,
        note: typeof row.note === 'string' ? row.note.trim().slice(0, 500) : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(0).toISOString(),
      }];
    });
  } catch {
    return [];
  }
}

export function dueDiligenceProgress(items: readonly SponsorDueDiligenceItem[]) {
  const byId = new Map(items.map((item) => [item.checkId, item]));
  const checks = SPONSOR_DUE_DILIGENCE_CHECKS.map((check) => {
    const current = byId.get(check.id);
    const status = current?.status ?? 'pending';
    const met = status === 'passed' || (status === 'waived' && !check.required);
    return { ...check, status, note: current?.note ?? '', updatedAt: current?.updatedAt ?? null, met };
  });
  const required = checks.filter((check) => check.required);
  return {
    checks,
    requiredMet: required.every((check) => check.met),
    requiredCount: required.length,
    requiredPassed: required.filter((check) => check.met).length,
    competitorBaasBlocked: byId.get('no_competitor_baas')?.status === 'failed',
  };
}

export function sponsorBankDocumentaryReady(evidence: OfficialRailEvidence, status: RailConnectionStatus) {
  if (status !== 'certified' && status !== 'live') return false;
  if (!evidence.counterpartyLegalName.trim() || !evidence.counterpartyTaxId.trim() || !evidence.contractReference.trim()) return false;
  if (!evidence.safeguardingAccountRef.trim()) return false;
  const progress = dueDiligenceProgress(evidence.dueDiligence);
  return progress.requiredMet && !progress.competitorBaasBlocked;
}

const STATUS_RANK: Record<RailConnectionStatus, number> = {
  unwired: 0,
  negotiating: 1,
  contracted: 2,
  certified: 3,
  live: 4,
};

export function canTransitionRailStatus(from: RailConnectionStatus, to: RailConnectionStatus) {
  if (from === to) return true;
  if (to === 'unwired') return from === 'negotiating';
  return STATUS_RANK[to] === STATUS_RANK[from] + 1 || STATUS_RANK[to] === STATUS_RANK[from] - 1;
}

export function assertSponsorBankTransition(
  from: RailConnectionStatus,
  to: RailConnectionStatus,
  evidence: OfficialRailEvidence,
) {
  if (!canTransitionRailStatus(from, to)) {
    return `Transición inválida de ${from} a ${to}.`;
  }
  if (to === 'contracted' || to === 'certified' || to === 'live') {
    if (!evidence.counterpartyLegalName.trim() || evidence.counterpartyLegalName.trim().length < 3) {
      return 'Indicá la razón social de la entidad financiera patrocinante.';
    }
    if (!evidence.counterpartyTaxId.trim() || evidence.counterpartyTaxId.trim().length < 7) {
      return 'Indicá el CUIT/identificador fiscal del banco patrocinante.';
    }
    if (!evidence.contractReference.trim()) {
      return 'Indicá la referencia del contrato de patrocinio.';
    }
  }
  if (to === 'certified' || to === 'live') {
    if (!evidence.safeguardingAccountRef.trim()) {
      return 'Indicá la referencia de la cuenta a la vista de fondos de clientes (sin secretos).';
    }
    const progress = dueDiligenceProgress(evidence.dueDiligence);
    if (progress.competitorBaasBlocked) {
      return 'El check “Sin BaaS competidor” está en failed: el patrocinio no puede arrastrar bindX como core.';
    }
    if (!progress.requiredMet) {
      return `Completá el due diligence requerido (${progress.requiredPassed}/${progress.requiredCount}).`;
    }
  }
  if (to === 'live' && !sponsorBankDocumentaryReady(evidence, 'certified')) {
    return 'Live del banco patrocinante exige evidencia documental completa; no despacha fondos.';
  }
  return null;
}

export function normalizeOfficialRailPatch(body: Record<string, unknown> | null) {
  if (!body) return null;
  const status = typeof body.status === 'string' ? body.status.trim() : undefined;
  if (status && !['unwired', 'negotiating', 'contracted', 'certified', 'live'].includes(status)) return null;

  const evidenceNote = typeof body.evidenceNote === 'string' ? body.evidenceNote.trim().slice(0, 2000) : undefined;
  const counterpartyLegalName = typeof body.counterpartyLegalName === 'string'
    ? body.counterpartyLegalName.trim().slice(0, 200) : undefined;
  const counterpartyTaxId = typeof body.counterpartyTaxId === 'string'
    ? body.counterpartyTaxId.trim().replace(/\s+/g, '').slice(0, 20) : undefined;
  const contractReference = typeof body.contractReference === 'string'
    ? body.contractReference.trim().slice(0, 120) : undefined;
  const safeguardingAccountRef = typeof body.safeguardingAccountRef === 'string'
    ? body.safeguardingAccountRef.trim().slice(0, 120) : undefined;

  let dueDiligence: SponsorDueDiligenceItem[] | undefined;
  if (body.dueDiligence !== undefined) {
    if (!Array.isArray(body.dueDiligence)) return null;
    const allowed = new Set(SPONSOR_DUE_DILIGENCE_CHECKS.map((item) => item.id));
    const statuses = new Set<string>(SPONSOR_DUE_DILIGENCE_STATUSES);
    const now = new Date().toISOString();
    const items: SponsorDueDiligenceItem[] = [];
    for (const raw of body.dueDiligence) {
      if (!raw || typeof raw !== 'object') return null;
      const row = raw as Record<string, unknown>;
      const checkId = typeof row.checkId === 'string' ? row.checkId : '';
      const itemStatus = typeof row.status === 'string' ? row.status : '';
      if (!allowed.has(checkId as SponsorDueDiligenceCheckId) || !statuses.has(itemStatus)) return null;
      items.push({
        checkId: checkId as SponsorDueDiligenceCheckId,
        status: itemStatus as SponsorDueDiligenceStatus,
        note: typeof row.note === 'string' ? row.note.trim().slice(0, 500) : '',
        updatedAt: now,
      });
    }
    dueDiligence = items;
  }

  if (
    status === undefined && evidenceNote === undefined && counterpartyLegalName === undefined
    && counterpartyTaxId === undefined && contractReference === undefined
    && safeguardingAccountRef === undefined && dueDiligence === undefined
  ) return null;

  return {
    status: status as RailConnectionStatus | undefined,
    evidenceNote,
    counterpartyLegalName,
    counterpartyTaxId,
    contractReference,
    safeguardingAccountRef,
    dueDiligence,
  };
}

export function mergeRailEvidence(
  current: OfficialRailEvidence,
  patch: NonNullable<ReturnType<typeof normalizeOfficialRailPatch>>,
): OfficialRailEvidence {
  return {
    evidenceNote: patch.evidenceNote ?? current.evidenceNote,
    counterpartyLegalName: patch.counterpartyLegalName ?? current.counterpartyLegalName,
    counterpartyTaxId: patch.counterpartyTaxId ?? current.counterpartyTaxId,
    contractReference: patch.contractReference ?? current.contractReference,
    safeguardingAccountRef: patch.safeguardingAccountRef ?? current.safeguardingAccountRef,
    dueDiligence: patch.dueDiligence ?? current.dueDiligence,
  };
}
