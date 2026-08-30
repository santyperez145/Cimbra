export const CAPABILITY_AVAILABILITY = ['sandbox', 'foundation', 'roadmap'] as const;
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
    features: ['multi-currency', 'double-entry ledger', 'holds y captures', 'reversas compensatorias', 'idempotencia'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox no custodia dinero. Cuentas transaccionales reales requieren licencia propia o patrocinio regulado y safeguarding.',
  },
  {
    id: 'payment-orchestration', name: 'Payment Orchestration', domain: 'payments', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Intents, cash-in, cash-out, transferencias, routing, estados, reintentos y reversas.',
    features: ['payment intents', 'cash-in/cash-out', 'routing por reglas', 'idempotencia', 'state machine', 'transfer dual approval'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Para liquidar dinero real Cimbra debe conectarse directamente a bancos, cámaras, esquemas o sponsors autorizados; no a plataformas competidoras.',
  },
  {
    id: 'instant-payments', name: 'Instant Payments & Transfers', domain: 'payments', availability: 'roadmap', delivery: 'cimbra_native',
    summary: 'Transferencias inmediatas, alias, QR interoperable, solicitudes de pago y devoluciones.',
    features: ['account-to-account', 'aliases', 'QR interoperable', 'request to pay', 'returns'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'files'], regulatoryBoundary: 'El acceso a Pix, SPEI, Transferencias 3.0 y otros rieles exige membresía, certificación o sponsor local.',
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
    id: 'acquiring', name: 'Acquiring & Acceptance', domain: 'commerce', availability: 'roadmap', delivery: 'cimbra_native',
    summary: 'Checkout, links, QR, Tap to Phone, POS, preautorizaciones, split y chargebacks.',
    features: ['checkout y links', 'QR y Tap to Phone', 'POS/TEF', 'preauthorization', 'split payments'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'iso8583'], regulatoryBoundary: 'Adquirencia real requiere licencia o sponsor adquirente, certificaciones EMV/PCI y acuerdos con marcas y comercios.',
  },
  {
    id: 'bill-payments', name: 'Bill Payments, Top-ups & Recurring', domain: 'commerce', availability: 'sandbox', delivery: 'cimbra_native',
    summary: 'Catálogo tenant, deuda emitida, pagos y recargas ledger-backed, reversas compensatorias y mandatos recurrentes con consentimiento.',
    features: ['service catalog', 'issued obligations', 'protected debt inquiry', 'bill pay', 'mobile top-ups', 'gift cards', 'recurring mandates', 'limits and retries', 'risk and holds', 'compensating reversals'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'El sandbox ejecuta el dominio propio de Cimbra, sin consultas simuladas ni dependencia de competidores. La cobertura comercial y el dinero real requieren convenios directos con cada originador, consentimiento exigible y certificación del riel por país.',
  },
  {
    id: 'wallets', name: 'Wallets & Embedded Finance', domain: 'core', availability: 'foundation', delivery: 'cimbra_native',
    summary: 'Wallet white-label, saldos, bolsillos, payouts y experiencias embebidas configurables.',
    features: ['white-label wallet', 'balances y pockets', 'payouts', 'program configuration', 'tenant branding'],
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
    features: ['REST API v1', 'TypeScript SDK', 'signed webhooks', 'sandbox', 'request tracing'],
    interfaces: ['rest_api', 'webhooks', 'sdk', 'console'], regulatoryBoundary: 'Disponible para integración técnica; los endpoints sandbox no autorizan ni liquidan fondos reales.',
  },
] as const;

export const PLATFORM_SUMMARY = {
  owner: 'Cimbra',
  strategy: 'build_native',
  competitorDependency: false,
  networkBoundary: 'direct_regulated_rails_only',
  availabilityModel: CAPABILITY_AVAILABILITY,
} as const;
