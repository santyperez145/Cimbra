export const CAPABILITY_AVAILABILITY = ['live', 'sandbox', 'foundation', 'roadmap'] as const;
export type CapabilityAvailability = typeof CAPABILITY_AVAILABILITY[number];

export const CAPABILITY_INTERFACES = ['rest_api', 'webhooks', 'sdk', 'console', 'iso8583', 'files', 'streaming'] as const;
export type CapabilityInterface = typeof CAPABILITY_INTERFACES[number];

export type PlatformCapability = {
  id: string;
  name: string;
  domain: 'core' | 'payments' | 'cards' | 'commerce' | 'credit' | 'risk' | 'operations' | 'platform';
  summary: string;
  features: readonly string[];
  interfaces: readonly CapabilityInterface[];
  availability: CapabilityAvailability;
  delivery: 'cimbra_native';
  regulatoryBoundary: string;
};

export const PLATFORM_CAPABILITIES: readonly PlatformCapability[] = [
  {
    id: 'identity-tenancy', name: 'Identity & Tenancy', domain: 'platform', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Identidad, organizaciones, invitaciones, roles, API keys, sesiones, MFA y aislamiento por tenant.',
    features: ['RBAC multi-tenant', 'invitaciones verificadas', 'jerarquía owner/admin', 'maker/checker', 'OAuth/OIDC', 'MFA TOTP', 'API keys con scopes', 'auditoría'],
    interfaces: ['rest_api', 'webhooks', 'console'], regulatoryBoundary: 'Cimbra administra identidad y autorización; cada cliente conserva la responsabilidad sobre sus usuarios autorizados.',
  },
  {
    id: 'customers-kyc', name: 'Customers, KYC & KYB', domain: 'risk', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Expedientes KYC/KYB versionados con partes, evidencia, checks append-only, vencimiento y decisión maker/checker.',
    features: ['customers y businesses', 'KYC/KYB derivado del tipo de cliente', 'partes y beneficiarios finales', 'documentos privados', 'checks append-only', 'policy snapshots', 'expiración', 'decisión owner/admin con MFA'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox orquesta evidencia y decisiones. Verificación biométrica, registros oficiales, listas regulatorias y aprobación productiva requieren fuentes directas certificadas y responsables habilitados por jurisdicción.',
  },
  {
    id: 'financial-core', name: 'Financial Core & Ledger', domain: 'core', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Cuentas, ledger de doble partida, holds, límites, fees, reversas y balances derivados.',
    features: ['multi-currency', 'double-entry ledger', 'native book transfers', 'account statements', 'holds y captures', 'reversas compensatorias', 'idempotencia'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox no custodia dinero. Cuentas transaccionales reales requieren licencia propia o patrocinio regulado y safeguarding.',
  },
  {
    id: 'payment-orchestration', name: 'Payment Orchestration', domain: 'payments', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Intents, cash-in, cash-out, transferencias, routing, estados, reintentos y reversas.',
    features: ['payment intents', 'cash-in/cash-out', 'routing por reglas', 'idempotencia', 'state machine', 'transfer dual approval'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Para liquidar dinero real Cimbra debe conectarse directamente a bancos, cámaras, esquemas o sponsors autorizados; no a plataformas competidoras.',
  },
  {
    id: 'native-payouts', name: 'Beneficiaries & Payout Batches', domain: 'payments', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Beneficiarios protegidos y lotes de payouts asíncronos, trazables por ítem y conectados al core financiero.',
    features: ['protected beneficiaries', 'immutable batches up to 100 items', 'maker/checker', 'scheduling and deadline', 'leased execution', 'per-item risk and ledger', 'result files'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'files', 'console'], regulatoryBoundary: 'El sandbox ejecuta y contabiliza el dominio propio de Cimbra. El envío y settlement de dinero real requiere conexión directa y homologada con bancos, cámaras o sponsors regulados por país.',
  },
  {
    id: 'instant-payments', name: 'Instant Payments & Transfers', domain: 'payments', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'CVU sandbox, alias tenant-scoped, crédito inmediato, solicitudes de débito internas, QR Cimbra dinámico, estático y de deuda, y devoluciones compensatorias.',
    features: ['sandbox CVU issuance', 'tenant aliases', 'assign/change alias', 'revoke CVU', 'holder confirmation', 'credit push', 'internal debit requests', 'Cimbra dynamic QR', 'Cimbra static QR', 'Cimbra sale orders', 'Cimbra QR debts', 'compensating returns'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox emite CVU con prefijo 0009999, no asignado por Coelsa, y no consulta el directorio nacional. Transferencias 3.0, DEBIN, QR interoperable y CBU reales exigen membresía, certificación o sponsor local directo. No hay conexión con BIND, Dock, tapi, Pismo, Pomelo ni Wibond.',
  },
  {
    id: 'card-issuing', name: 'Card Issuing', domain: 'cards', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Programas tenant, instrumentos físicos/virtuales, lifecycle terminal y controles versionados sin datos PCI.',
    features: ['debit/credit/prepaid', 'virtual/physical', 'explicit card lifecycle', 'versioned spend controls', 'channel and MCC policy'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox no genera PAN/CVV ni aplica controles en una red. Emisión real y tokenización requieren BIN sponsor o membresía, HSM, personalización certificada, PCI DSS y homologación de esquema.',
  },
  {
    id: 'disputes-chargebacks', name: 'Disputes & Chargebacks', domain: 'operations', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Disputas parciales, lifecycle explícito, evidencia privada, work queue y créditos compensables. Modular para cualquier riel.',
    features: ['partial disputes', 'explicit state machine', 'provisional credits', 'compensating entries', 'private evidence', 'unified work queue', 'dual approval'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox administra expedientes y ledger interno. La presentación real requiere conexión directa, sponsor y certificación con cada red, banco o cámara.',
  },
  {
    id: 'card-processing', name: 'Card Processing & Authorization', domain: 'cards', availability: 'roadmap', delivery: 'cimbra_native',
    summary: 'Autorización online/stand-in, clearing, presentments, reversals y 3DS.',
    features: ['real-time authorization', 'stand-in', 'clearing', 'presentments', '3DS'],
    interfaces: ['rest_api', 'webhooks', 'iso8583', 'files', 'streaming'], regulatoryBoundary: 'Procesamiento conectado a redes requiere PCI DSS, HSM, certificación de esquema y acuerdos de conectividad.',
  },
  {
    id: 'acquiring', name: 'Acquiring & Collections', domain: 'commerce', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Links de cobro sandbox, asociación a deuda QR o till CVU, ítems de checkout informativos, créditos parciales al CVU, devoluciones parciales compensatorias, checkout público de marca blanca, puntos de recaudación con CVU propio y QR estático del till, eco cerrado, inbound ledger y devoluciones compensatorias.',
    features: ['payment links', 'link associated with QR debt', 'link associated with collection till', 'checkout display items', 'embedded CVU credits', 'CVU partial credits', 'partial refunds', 'white-label checkout page', 'collection tills', 'sandbox CVU per till', 'till-owned static QR', 'closed-amount-only till QR', 'internal collect', 'sandbox inbound cash-in', 'compensating refunds'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'],     regulatoryBoundary: 'El sandbox cobra entre cuentas Cimbra, acredita un till con CVU 000+9999 o simula un inbound sobre el ledger. El QR estático del till no es interoperable ni EMVCo. No procesa tarjetas, POS, Tap to Phone ni QR de red. El CVU del till no viaja por Coelsa. Adquirencia real exige licencia o sponsor, PCI/EMV y acuerdos con marcas. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.',
  },
  {
    id: 'echeqs', name: 'ECHEQ', domain: 'payments', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Cheques electrónicos internos: emisión, aceptación, endoso, depósito ledger-backed, anulación y devolución previa al depósito.',
    features: ['issue against ARS accounts', 'CUIT validation', 'accept and endorse', 'to-order restriction', 'internal deposit', 'NSF rejection', 'pre-deposit return'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox no emite ECHEQ reales ni habla con Coelsa. El payload cimbra:echeq:v1 no es CMC7. Descuento, custodia, USD y depósito en CBU/CVU de cámara responden 422. Compensación real exige cuenta corriente, membresía o sponsor y riel directo. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son conectores.',
  },
  {
    id: 'bill-payments', name: 'Bill Payments, Top-ups & Recurring', domain: 'commerce', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Catálogo tenant, deuda emitida, pagos y recargas ledger-backed, reversas compensatorias y mandatos recurrentes con consentimiento.',
    features: ['service catalog', 'issued obligations', 'protected debt inquiry', 'bill pay', 'mobile top-ups', 'gift cards', 'recurring mandates', 'limits and retries', 'risk and holds', 'compensating reversals'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox ejecuta el dominio propio de Cimbra, sin consultas simuladas ni dependencia de competidores. La cobertura comercial y el dinero real requieren convenios directos con cada originador, consentimiento exigible y certificación del riel por país.',
  },
  {
    id: 'wallets', name: 'Wallets & Embedded Finance', domain: 'core', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Programas white-label, wallets por cliente, bolsillos ledger-backed y movimientos internos entre pockets.',
    features: ['program configuration', 'tenant branding', 'customer wallets', 'ledger-backed pockets', 'pocket transfers', 'freeze and close lifecycle'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Una wallet con fondos reales debe operar bajo el marco PSP, entidad financiera o equivalente de cada país.',
  },
  {
    id: 'lending', name: 'Lending & Credit', domain: 'credit', availability: 'roadmap', delivery: 'cimbra_native',
    summary: 'Originación, líneas, desembolsos, cronogramas, intereses, cobranzas y mora.',
    features: ['origination', 'credit lines', 'schedules', 'interest and fees', 'collections'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Otorgamiento y fondeo exigen entidad habilitada, políticas crediticias, reporting y tratamiento de datos conforme a cada mercado.',
  },
  {
    id: 'risk-fraud', name: 'Risk & Fraud', domain: 'risk', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Rules engine, velocity, scoring explicable, step-up OTP, SLO medido y casos vinculados a holds.',
    features: ['rules engine', 'immutable policy versions', 'champion/challenger simulation', 'velocity limits', 'risk scoring', 'OTP step-up lifecycle', 'decision latency SLO', 'case management', 'hold resolution', 'case resolution dual approval'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Los modelos y reglas requieren datos representativos, monitoreo de sesgo y aprobación humana según impacto y regulación.',
  },
  {
    id: 'reconciliation-settlement', name: 'Reconciliation & Settlement', domain: 'operations', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Ingestión API/CSV, comparación contra el ledger, work queue con SLA y ciclos de settlement sandbox.',
    features: ['batch reconciliation', 'CSV ingestion', 'unified work queue', 'assignment and SLA', 'private evidence', 'scheduled settlement cycles', 'settlement and exception dual approval'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'files', 'console'], regulatoryBoundary: 'La conciliación productiva depende de extractos oficiales de cada banco, cámara o red y segregación operativa; el settlement sandbox no mueve fondos.',
  },
  {
    id: 'treasury', name: 'Treasury & Liquidity', domain: 'operations', availability: 'roadmap', delivery: 'cimbra_native',
    summary: 'Posición, prefunding, cash forecasting, límites de contraparte y movimientos internos.',
    features: ['cash position', 'prefunding', 'forecasting', 'counterparty limits', 'sweeps'],
    interfaces: ['rest_api', 'webhooks', 'files', 'console'], regulatoryBoundary: 'La ejecución de tesorería requiere cuentas bancarias controladas, mandatos, segregación y políticas aprobadas.',
  },
  {
    id: 'developer-platform', name: 'Developer Platform', domain: 'platform', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'API versionada, SDK oficial, webhooks firmados, sandbox, observabilidad e idempotencia.',
    features: ['REST API v1', 'TypeScript SDK', 'signed webhooks', 'sandbox and live environments', 'request tracing'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Disponible para integración técnica; los endpoints sandbox no autorizan ni liquidan fondos reales.',
  },
  {
    id: 'capital-live-path', name: 'Capital Plan & Investor Evidence', domain: 'platform', availability: 'foundation', delivery: 'cimbra_native',
    summary: 'Envelope de USD 500 para Gate 1, data room público sin tracción inventada y camino PSPCP fail-closed.',
    features: ['USD 500 Gate 1 envelope', 'forbidden AWS/Coelsa/Go Live spend', 'public /investors data room', 'live-readiness capitalPlan', 'zero invented traction'],
    interfaces: ['rest_api', 'console'], regulatoryBoundary: 'El presupuesto no inscribe el PSP, no paga Coelsa ni un sponsor, no constituye SAS y no habilita dinero real. BIND, Dock, tapi, Pismo, Pomelo y Wibond no son un destino de gasto.',
  },
] as const;

export const PLATFORM_SUMMARY = {
  owner: 'Cimbra',
  strategy: 'build_native',
  competitorDependency: false,
  networkBoundary: 'direct_regulated_rails_only',
  availabilityModel: CAPABILITY_AVAILABILITY,
  graduation: 'integracion_homologacion_go_live',
} as const;
