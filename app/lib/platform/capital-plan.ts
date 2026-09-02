/** Presupuesto autorizado de USD 500: Gate 1 comercial. No compra riel, AWS ni Go Live. */

export const CAPITAL_ALLOCATION_STATUSES = ['authorized_unspent', 'spent', 'exhausted'] as const;
export type CapitalAllocationStatus = typeof CAPITAL_ALLOCATION_STATUSES[number];

export const DEMO_INTENTS = ['design_session', 'investor', 'design_partner'] as const;
export type DemoIntent = typeof DEMO_INTENTS[number];

export function isDemoIntent(value: unknown): value is DemoIntent {
  return typeof value === 'string' && (DEMO_INTENTS as readonly string[]).includes(value);
}

export function normalizeDemoIntent(value: unknown): DemoIntent {
  return isDemoIntent(value) ? value : 'design_session';
}

export function composeLeadMessage(intent: DemoIntent, message: string) {
  const body = message.trim();
  return intent === 'design_session' ? body : `[intent:${intent}] ${body}`.trim();
}

export const CAPITAL_PLAN = {
  currency: 'USD' as const,
  envelope: 500,
  commercialGate: 'gate_1_design_partners' as const,
  liveReadyAfterSpend: false,
  spent: 0,
  summary: 'USD 500 alcanza para Gate 1: consulta legal del camino SAS/PSPCP, dominio, entrevistas a design partners y correo transaccional. No constituye sociedad, no inscribe el PSP, no paga Coelsa ni un banco patrocinante, y no autoriza AWS pago ni Go Live.',
  officialSources: [
    {
      name: 'BCRA — Registro de PSP',
      url: 'https://www.bcra.gob.ar/inscripcion-registro-proveedores-servicios-de-pago/',
      surface: 'La inscripción ante SEFyC es un trámite gratuito, pero exige persona jurídica argentina, estatuto, DJ, composición accionaria y banco patrocinante para la figura PSPCP.',
    },
    {
      name: 'BCRA — Billeteras digitales interoperables',
      url: 'https://www.bcra.gob.ar/inscripcion-registro-billeteras-digitales-interoperables/',
      surface: 'Registro adicional si Cimbra inicia pagos como billetera. No se habilita con un envelope de USD 500.',
    },
    {
      name: 'Coelsa',
      url: 'https://www.coelsa.com.ar/',
      surface: 'Cámara de directorio, Transferencias 3.0, DEBIN, ECHEQ y QR/PCT. La membresía y certificación superan este presupuesto.',
    },
  ],
  allocations: [
    {
      id: 'legal_consult',
      amount: 200,
      status: 'authorized_unspent' as const,
      name: 'Consulta legal fintech',
      summary: 'Una sesión con abogado societario/fintech argentino sobre SAS, objeto social y camino PSPCP. No constituye la sociedad ni presenta la inscripción BCRA.',
    },
    {
      id: 'trademark_domain',
      amount: 70,
      status: 'authorized_unspent' as const,
      name: 'Dominio y búsqueda marcaria',
      summary: 'Dominio propio y búsqueda de anterioridad. No alcanza para el registro de marca completo ni para la constitución societaria.',
    },
    {
      id: 'design_partners',
      amount: 180,
      status: 'authorized_unspent' as const,
      name: 'Entrevistas a design partners',
      summary: 'Hasta 15 conversaciones con compradores (transporte, herramientas, grabación). No compra cartas de intención ni volumen.',
    },
    {
      id: 'transactional_email',
      amount: 50,
      status: 'authorized_unspent' as const,
      name: 'Correo transaccional',
      summary: 'Dominio de correo verificado en el proveedor ya previsto (Resend). No provisiona AWS pago.',
    },
  ],
  forbidden: [
    { id: 'aws_paid', name: 'AWS pago', summary: 'Terraform queda reproducible. Ningún recurso de AWS se activa sin autorización expresa de gasto, y este envelope no la otorga.' },
    { id: 'coelsa_membership', name: 'Membresía Coelsa', summary: 'Directorio, T3.0, DEBIN, ECHEQ y PCT exigen contrato y certificación de cámara, no un presupuesto de discovery.' },
    { id: 'sponsor_bank', name: 'Banco patrocinante', summary: 'El BCRA exige informar el o los bancos patrocinantes para PSPCP. Un retainer bancario no entra en USD 500.' },
    { id: 'pci_qsa', name: 'PCI DSS / QSA', summary: 'AOC y perímetro de tarjetas son un programa de certificación, no un renglón de Gate 1.' },
    { id: 'sas_constitution', name: 'Constitución SAS', summary: 'Escribano, tasas y capital social superan este envelope. El trámite PSP es gratuito después de tener persona jurídica, no antes.' },
    { id: 'mark_go_live', name: 'Marcar Go Live', summary: 'liveReady sigue exigiendo hostname de producción, producto homologado, riel live y adaptador Cimbra. Gastar USD 500 no cambia eso.' },
    { id: 'competitor_connector', name: 'Conector a un competidor', summary: 'BIND, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks, nunca un gasto de integración.' },
  ],
  seedUses: [
    'Constitución de SAS argentina con objeto compatible con servicios de pago.',
    'Oficial de cumplimiento / UIF y documentación para la inscripción PSPCP.',
    'Conversaciones y contrato con banco patrocinante.',
    'Membresía y certificación Coelsa cuando exista figura legal.',
    'Hostname de producción, secretos y operación; sin AWS pago hasta autorización expresa.',
  ],
  raise: {
    instrument: 'pre_seed' as const,
    amountUsd: null,
    thesis: 'El próximo cheque financia persona jurídica, compliance y el primer riel regulado. No hay ronda tasada ni tracción inventada: el sandbox es evidencia de producto, no de volumen.',
  },
} as const;

export function capitalPlanSnapshot() {
  const allocated = CAPITAL_PLAN.allocations.reduce((sum, item) => sum + item.amount, 0);
  return {
    currency: CAPITAL_PLAN.currency,
    envelope: CAPITAL_PLAN.envelope,
    allocated,
    remaining: CAPITAL_PLAN.envelope - allocated,
    spent: CAPITAL_PLAN.spent,
    commercialGate: CAPITAL_PLAN.commercialGate,
    liveReadyAfterSpend: CAPITAL_PLAN.liveReadyAfterSpend,
    summary: CAPITAL_PLAN.summary,
    officialSources: [...CAPITAL_PLAN.officialSources],
    allocations: CAPITAL_PLAN.allocations.map((item) => ({ ...item })),
    forbidden: CAPITAL_PLAN.forbidden.map((item) => ({ ...item })),
    seedUses: [...CAPITAL_PLAN.seedUses],
    raise: { ...CAPITAL_PLAN.raise },
  };
}

export type CapitalPlan = ReturnType<typeof capitalPlanSnapshot>;

export function isForbiddenCapitalSpend(id: string) {
  return CAPITAL_PLAN.forbidden.some((item) => item.id === id);
}
