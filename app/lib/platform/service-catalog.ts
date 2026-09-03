export type ServiceRuntime = 'in_process' | 'standalone';

export type ExtractionDebt = {
  table: string;
  owner: string;
  reason: string;
};

export type ServiceDefinition = {
  id: string;
  name: string;
  mission: string;
  runtime: ServiceRuntime;
  ownedTables: readonly string[];
  modules: readonly string[];
  apiSurfaces: readonly string[];
  publishes: readonly string[];
  extractionGate: string;
  benchmark: string;
  extractionDebt: readonly ExtractionDebt[];
};

/**
 * Tablas del kernel que cualquier servicio puede escribir a través del contrato de auditoría.
 * Es la única excepción permitida a la propiedad exclusiva de datos.
 */
export const KERNEL_CONTRACT_TABLES = ['audit_events'] as const;

export const SERVICE_CATALOG: readonly ServiceDefinition[] = [
  {
    id: 'identity',
    name: 'Identidad y acceso',
    mission: 'Autenticación, sesiones, MFA, miembros, invitaciones y credenciales de API del tenant.',
    runtime: 'in_process',
    ownedTables: [
      'users', 'oauth_identities', 'oauth_states', 'auth_sessions', 'auth_attempts', 'auth_action_tokens',
      'mfa_recovery_codes', 'members', 'organization_invitations', 'api_keys',
    ],
    modules: [
      'db/access.ts', 'app/lib/auth/accounts.ts', 'app/lib/auth/lifecycle.ts', 'app/lib/auth/mfa.ts',
      'app/lib/auth/oauth.ts', 'app/lib/auth/session.ts', 'app/lib/platform/api-keys.ts',
      'app/lib/platform/authorization.ts',
    ],
    apiSurfaces: ['app/api/auth'],
    publishes: ['organization.invitation_', 'organization.member_'],
    extractionGate: 'Se extrae cuando el tenant exija SSO empresarial propio o el volumen de verificación de credenciales degrade la latencia del resto de los servicios.',
    benchmark: 'Los emisores comparables aíslan identidad del procesamiento para poder rotar credenciales sin tocar el core transaccional.',
    extractionDebt: [
      { table: 'organizations', owner: 'tenants', reason: 'El alta de cuenta crea la organización en la misma transacción que el usuario.' },
      { table: 'reconciliation_exceptions', owner: 'reconciliation', reason: 'Al remover un miembro se libera la asignación de sus excepciones.' },
      { table: 'risk_cases', owner: 'risk', reason: 'Al remover un miembro se libera la asignación de sus casos de riesgo.' },
    ],
  },
  {
    id: 'tenants',
    name: 'Organizaciones y plataforma',
    mission: 'Perfil del tenant, operadores de plataforma Cimbra y pipeline comercial de leads.',
    runtime: 'in_process',
    ownedTables: ['organizations', 'platform_operators', 'leads', 'capital_allocations'],
    modules: ['db/organization.ts', 'db/capital.ts', 'app/api/demo/route.ts'],
    apiSurfaces: ['app/api/v1/organization', 'app/api/v1/services', 'app/api/ops', 'app/api/demo'],
    publishes: ['organization.updated'],
    extractionGate: 'Se extrae cuando la superadministración necesite un plano de control separado del plano de datos del tenant.',
    benchmark: 'Las plataformas comparables separan el control plane multi-tenant de la operación de cada cliente.',
    extractionDebt: [],
  },
  {
    id: 'support',
    name: 'Soporte',
    mission: 'Casos de soporte del tenant, conversación con Cimbra y trazabilidad de resolución.',
    runtime: 'in_process',
    ownedTables: ['support_cases', 'support_messages'],
    modules: ['db/support.ts'],
    apiSurfaces: ['app/api/v1/support'],
    publishes: ['support.'],
    extractionGate: 'Se extrae cuando el volumen de casos exija enrutamiento, SLA por severidad y turnos de guardia dedicados.',
    benchmark: 'Los proveedores comparables exponen soporte con caso, historial y estado auditable, no sólo un correo de contacto.',
    extractionDebt: [],
  },
  {
    id: 'customers',
    name: 'Clientes',
    mission: 'Registro canónico de personas y empresas del tenant.',
    runtime: 'in_process',
    ownedTables: ['customers'],
    modules: ['app/api/sandbox/customers/route.ts'],
    apiSurfaces: ['app/api/v1/customers'],
    publishes: ['customer.'],
    extractionGate: 'Se extrae cuando el padrón de clientes se comparta entre varios productos con reglas de deduplicación propias.',
    benchmark: 'El padrón de clientes es un servicio independiente del producto que lo consume en las plataformas comparables.',
    extractionDebt: [],
  },
  {
    id: 'ledger',
    name: 'Ledger',
    mission: 'Contabilidad de doble partida, cuentas financieras, retenciones y transacciones. Fuente de verdad del dinero.',
    runtime: 'in_process',
    ownedTables: ['ledger_journals', 'ledger_postings', 'financial_accounts', 'holds', 'transactions'],
    modules: ['db/ledger.ts'],
    apiSurfaces: ['app/api/v1/ledger', 'app/api/v1/holds', 'app/api/v1/accounts'],
    publishes: ['transfer.', 'payment.', 'hold.'],
    extractionGate: 'Es el último servicio a extraer: sólo se separa con particionamiento por tenant y prueba de consistencia contable en paralelo.',
    benchmark: 'El ledger de doble partida es el núcleo no negociable de las plataformas de infraestructura financiera.',
    extractionDebt: [
      { table: 'book_transfers', owner: 'accounts', reason: 'La liquidación contable cierra la transferencia interna en la misma transacción.' },
      { table: 'echeqs', owner: 'echeqs', reason: 'La acreditación del echeq se asienta junto con su posting contable.' },
      { table: 'instant_transfers', owner: 'instant-payments', reason: 'La confirmación del pago inmediato se asienta junto con su posting.' },
      { table: 'payment_links', owner: 'collections', reason: 'La acreditación del link de cobro se asienta junto con su posting.' },
      { table: 'payment_qrs', owner: 'collections', reason: 'La acreditación del QR se asienta junto con su posting.' },
      { table: 'qr_debts', owner: 'collections', reason: 'La cancelación de la deuda QR se asienta junto con su posting.' },
      { table: 'qr_sale_orders', owner: 'collections', reason: 'El cierre de la orden de venta se asienta junto con su posting.' },
      { table: 'payout_batches', owner: 'payouts', reason: 'El débito del lote se asienta junto con su posting.' },
      { table: 'payout_items', owner: 'payouts', reason: 'La imputación por ítem se asienta junto con su posting.' },
      { table: 'bill_payment_orders', owner: 'bill-payments', reason: 'El pago de la factura se asienta junto con su posting.' },
      { table: 'biller_obligations', owner: 'bill-payments', reason: 'La obligación se cancela junto con el posting que la paga.' },
    ],
  },
  {
    id: 'accounts',
    name: 'Cuentas y transferencias internas',
    mission: 'Cuentas operativas del tenant y transferencias libro a libro.',
    runtime: 'in_process',
    ownedTables: ['accounts', 'book_transfers'],
    modules: ['db/book-transfers.ts', 'app/api/sandbox/accounts/route.ts'],
    apiSurfaces: ['app/api/v1/book-transfers', 'app/api/v1/transfers'],
    publishes: ['account.', 'book_transfer.'],
    extractionGate: 'Se extrae junto con el ledger, porque comparte la transacción contable.',
    benchmark: 'La transferencia interna es una operación de core bancario que se apoya en el ledger, no un producto separado.',
    extractionDebt: [
      { table: 'holds', owner: 'ledger', reason: 'La transferencia retiene fondos en la misma transacción para evitar sobregiro.' },
      { table: 'transactions', owner: 'ledger', reason: 'La transferencia registra su transacción contable de forma atómica.' },
    ],
  },
  {
    id: 'wallets',
    name: 'Wallets',
    mission: 'Programas de wallet, cuentas de usuario final, bolsillos y ciclo de vida.',
    runtime: 'in_process',
    ownedTables: ['wallet_programs', 'wallets', 'wallet_pockets', 'wallet_lifecycle_events'],
    modules: ['db/wallets.ts'],
    apiSurfaces: ['app/api/v1/wallets', 'app/api/v1/wallet-programs'],
    publishes: ['wallet.'],
    extractionGate: 'Se extrae cuando el producto wallet tenga volumen propio y necesite despliegues independientes del core.',
    benchmark: 'Las plataformas comparables tratan wallet como producto separado del emisor de tarjetas.',
    extractionDebt: [
      { table: 'accounts', owner: 'accounts', reason: 'El alta de wallet crea su cuenta operativa asociada de forma atómica.' },
    ],
  },
  {
    id: 'payouts',
    name: 'Pagos masivos',
    mission: 'Beneficiarios, lotes de pago y ejecución por ítem con doble control.',
    runtime: 'in_process',
    ownedTables: ['payout_beneficiaries', 'payout_batches', 'payout_items'],
    modules: ['db/payouts.ts'],
    apiSurfaces: ['app/api/v1/payout-batches', 'app/api/v1/payout-beneficiaries'],
    publishes: ['payout.'],
    extractionGate: 'Se extrae cuando los lotes requieran ventanas de procesamiento batch aisladas del tráfico transaccional.',
    benchmark: 'El procesamiento masivo se aísla del online para que un lote grande no degrade la API.',
    extractionDebt: [
      { table: 'approval_requests', owner: 'approvals', reason: 'El lote abre su solicitud de aprobación en la misma transacción.' },
    ],
  },
  {
    id: 'cards',
    name: 'Emisión de tarjetas',
    mission: 'Programas de emisión, tarjetas, controles de uso y ciclo de vida.',
    runtime: 'in_process',
    ownedTables: ['card_programs', 'cards', 'card_lifecycle_events', 'card_controls'],
    modules: ['db/card-issuing.ts', 'app/api/sandbox/cards/route.ts'],
    apiSurfaces: ['app/api/v1/cards', 'app/api/v1/card-programs'],
    publishes: ['card.'],
    extractionGate: 'Se extrae al certificar con una red: el perímetro ISO 8583 exige aislamiento, HSM y disponibilidad propia.',
    benchmark: 'El procesamiento de tarjetas vive en un perímetro certificado y separado del resto de la plataforma.',
    extractionDebt: [],
  },
  {
    id: 'collections',
    name: 'Cobros',
    mission: 'Links de cobro, QR, órdenes de venta, deudas QR, cajas y devoluciones.',
    runtime: 'in_process',
    ownedTables: [
      'payment_links', 'payment_link_credits', 'payment_link_refunds', 'payment_qrs', 'qr_sale_orders',
      'qr_debts', 'collection_tills',
    ],
    modules: ['db/collections.ts'],
    apiSurfaces: [
      'app/api/v1/payment-links', 'app/api/v1/payment-qrs', 'app/api/v1/qr-sale-orders',
      'app/api/v1/qr-debts', 'app/api/v1/collection-tills',
    ],
    publishes: ['collection.'],
    extractionGate: 'Se extrae cuando el checkout público necesite escalar y cachear con independencia del core.',
    benchmark: 'El checkout de cara al pagador se escala aparte porque su tráfico es errático y de origen público.',
    extractionDebt: [
      { table: 'holds', owner: 'ledger', reason: 'El cobro retiene fondos del pagador de forma atómica.' },
      { table: 'transactions', owner: 'ledger', reason: 'La acreditación del cobro registra su transacción contable.' },
      { table: 'instant_transfers', owner: 'instant-payments', reason: 'El cobro por transferencia inmediata origina el movimiento en el mismo commit.' },
    ],
  },
  {
    id: 'instant-payments',
    name: 'Pagos inmediatos',
    mission: 'Transferencias inmediatas e instrumentos de riel (CVU, CBU, alias).',
    runtime: 'in_process',
    ownedTables: ['instant_transfers', 'rail_instruments'],
    modules: ['db/instant-payments.ts'],
    apiSurfaces: ['app/api/v1/instant-transfers', 'app/api/v1/rail-instruments'],
    publishes: ['instant.', 'rail.'],
    extractionGate: 'Se extrae al conectar un riel real: la disponibilidad exigida por la cámara no puede depender del resto de la plataforma.',
    benchmark: 'La conexión al riel de pagos inmediatos se opera con disponibilidad y guardia propias.',
    extractionDebt: [
      { table: 'holds', owner: 'ledger', reason: 'La transferencia retiene fondos antes de despachar al riel.' },
      { table: 'transactions', owner: 'ledger', reason: 'La confirmación registra su transacción contable de forma atómica.' },
      { table: 'payment_links', owner: 'collections', reason: 'La acreditación cierra el link de cobro que la originó.' },
      { table: 'payment_qrs', owner: 'collections', reason: 'La acreditación cierra el QR que la originó.' },
      { table: 'qr_debts', owner: 'collections', reason: 'La acreditación cancela la deuda QR que la originó.' },
      { table: 'qr_sale_orders', owner: 'collections', reason: 'La acreditación cierra la orden de venta que la originó.' },
    ],
  },
  {
    id: 'rails',
    name: 'Rieles oficiales',
    mission: 'Catálogo de rieles y estado de las conexiones oficiales con bancos, cámaras y autoridades; evidencia del banco patrocinante PSPCP.',
    runtime: 'in_process',
    ownedTables: ['platform_rails', 'official_rail_connections'],
    modules: ['db/platform-rails.ts', 'app/lib/platform/official-rails.ts', 'app/lib/platform/sponsor-bank.ts'],
    apiSurfaces: ['app/api/v1/rail-directory', 'app/api/ops/rails'],
    publishes: [],
    extractionGate: 'Se extrae cuando existan conexiones productivas con más de un riel y requieran despliegue por riel.',
    benchmark: 'El estado de cada riel es información operativa de primer orden en las plataformas comparables.',
    extractionDebt: [],
  },
  {
    id: 'bill-payments',
    name: 'Pago de facturas',
    mission: 'Empresas recaudadoras, obligaciones, mandatos recurrentes y órdenes de pago.',
    runtime: 'in_process',
    ownedTables: [
      'billers', 'biller_obligations', 'recurring_payment_mandates', 'bill_payment_orders',
      'recurring_payment_executions',
    ],
    modules: ['db/billers.ts'],
    apiSurfaces: ['app/api/v1/billers', 'app/api/v1/bill-payments', 'app/api/v1/recurring-mandates', 'app/api/v1/debit-requests'],
    publishes: ['biller.', 'bill_payment.', 'recurring_mandate.'],
    extractionGate: 'Se extrae cuando la integración con recaudadoras exija ventanas y reintentos propios.',
    benchmark: 'La recaudación se integra con catálogos externos y conviene aislarla de la operación propia.',
    extractionDebt: [],
  },
  {
    id: 'echeqs',
    name: 'Echeqs',
    mission: 'Cheques electrónicos, endosos y acreditación.',
    runtime: 'in_process',
    ownedTables: ['echeqs', 'echeq_endorsements'],
    modules: ['db/echeqs.ts'],
    apiSurfaces: ['app/api/v1/echeqs'],
    publishes: ['echeq.'],
    extractionGate: 'Se extrae al integrar el registro oficial de cheques electrónicos.',
    benchmark: 'El echeq es un instrumento con registro externo propio y ciclo de vida independiente.',
    extractionDebt: [
      { table: 'holds', owner: 'ledger', reason: 'El echeq retiene fondos hasta su acreditación.' },
      { table: 'transactions', owner: 'ledger', reason: 'La acreditación registra su transacción contable de forma atómica.' },
    ],
  },
  {
    id: 'risk',
    name: 'Riesgo y fraude',
    mission: 'Reglas, simulaciones, listas, evaluaciones, step-up y casos de riesgo.',
    runtime: 'in_process',
    ownedTables: [
      'risk_rules', 'risk_rule_promotions', 'risk_simulations', 'risk_list_entries', 'risk_evaluations',
      'risk_step_up_challenges', 'risk_step_up_attempts', 'risk_cases', 'risk_outcomes',
    ],
    modules: ['db/risk.ts'],
    apiSurfaces: ['app/api/v1/risk'],
    publishes: ['risk.'],
    extractionGate: 'Se extrae cuando la evaluación en línea necesite modelos y latencia propias sin bloquear la autorización.',
    benchmark: 'El motor de riesgo es un servicio consultado sincrónicamente y desplegado por separado en las plataformas comparables.',
    extractionDebt: [],
  },
  {
    id: 'compliance',
    name: 'Cumplimiento',
    mission: 'Documentación, legajos de debida diligencia, verificaciones y evidencia.',
    runtime: 'in_process',
    ownedTables: [
      'compliance_documents', 'due_diligence_cases', 'due_diligence_parties', 'due_diligence_checks',
      'due_diligence_events',
    ],
    modules: ['db/due-diligence.ts', 'app/api/compliance/documents/route.ts'],
    apiSurfaces: ['app/api/v1/due-diligence', 'app/api/v1/compliance', 'app/api/compliance'],
    publishes: ['compliance.', 'due_diligence.'],
    extractionGate: 'Se extrae cuando la retención documental exija almacenamiento y política de acceso separados.',
    benchmark: 'La evidencia de cumplimiento se custodia aparte por requisitos de retención y auditoría.',
    extractionDebt: [],
  },
  {
    id: 'disputes',
    name: 'Disputas',
    mission: 'Contracargos, evidencia y ciclo de vida de la disputa.',
    runtime: 'in_process',
    ownedTables: ['disputes', 'dispute_events'],
    modules: ['db/disputes.ts'],
    apiSurfaces: ['app/api/v1/disputes'],
    publishes: ['dispute.'],
    extractionGate: 'Se extrae junto con tarjetas cuando el ciclo de contracargo se rija por los plazos de la red.',
    benchmark: 'La disputa sigue calendarios de red y conviene operarla con su propio reloj.',
    extractionDebt: [],
  },
  {
    id: 'reconciliation',
    name: 'Conciliación',
    mission: 'Corridas de conciliación, ítems y excepciones contra fuentes externas.',
    runtime: 'in_process',
    ownedTables: ['reconciliation_runs', 'reconciliation_items', 'reconciliation_exceptions'],
    modules: ['db/reconciliation.ts'],
    apiSurfaces: ['app/api/v1/reconciliation'],
    publishes: ['reconciliation.'],
    extractionGate: 'Se extrae cuando el batch diario compita por recursos con el tráfico en línea.',
    benchmark: 'La conciliación es un proceso batch que se aísla para no degradar la operación en línea.',
    extractionDebt: [],
  },
  {
    id: 'settlements',
    name: 'Liquidación',
    mission: 'Ciclos de liquidación y su cierre contra el ledger.',
    runtime: 'in_process',
    ownedTables: ['settlement_cycles'],
    modules: ['db/settlements.ts'],
    apiSurfaces: ['app/api/v1/settlements'],
    publishes: ['settlement.'],
    extractionGate: 'Se extrae cuando existan ciclos por riel y moneda con calendarios distintos.',
    benchmark: 'La liquidación se organiza por ciclo, riel y moneda en las plataformas comparables.',
    extractionDebt: [],
  },
  {
    id: 'operations',
    name: 'Operación',
    mission: 'Cola operativa, acciones, notas y evidencia de resolución.',
    runtime: 'in_process',
    ownedTables: ['operational_actions', 'operational_notes', 'operational_evidence_links'],
    modules: ['db/operations.ts'],
    apiSurfaces: ['app/api/v1/operations'],
    publishes: ['operations.'],
    extractionGate: 'Se extrae cuando la mesa de operación necesite herramientas y permisos propios de back office.',
    benchmark: 'El back office se separa del producto para segregar funciones y limitar el alcance de cada operador.',
    extractionDebt: [],
  },
  {
    id: 'approvals',
    name: 'Aprobaciones',
    mission: 'Políticas de doble control y solicitudes de aprobación de operaciones sensibles.',
    runtime: 'in_process',
    ownedTables: ['approval_policies', 'approval_requests'],
    modules: ['db/approvals.ts'],
    apiSurfaces: ['app/api/v1/approvals'],
    publishes: ['approval.'],
    extractionGate: 'Se extrae cuando el doble control gobierne operaciones de varios servicios con flujos propios.',
    benchmark: 'La segregación de funciones exige que quien aprueba no sea quien ejecuta.',
    extractionDebt: [],
  },
  {
    id: 'events',
    name: 'Kernel de eventos y auditoría',
    mission: 'Auditoría inmutable, endpoints de webhook, cola de eventos y reintentos de entrega.',
    runtime: 'in_process',
    ownedTables: ['audit_events', 'webhook_endpoints', 'webhook_events', 'webhook_deliveries', 'webhook_delivery_attempts'],
    modules: ['db/platform.ts', 'db/runtime.ts', 'app/lib/platform/webhooks.ts'],
    apiSurfaces: ['app/api/v1/events', 'app/api/v1/webhooks'],
    publishes: [],
    extractionGate: 'Es el primer candidato a extracción: la entrega con reintentos no debe competir con la API transaccional.',
    benchmark: 'La entrega de webhooks con reintentos y firma se opera como servicio propio en las plataformas comparables.',
    extractionDebt: [],
  },
];

export function serviceById(id: string) {
  return SERVICE_CATALOG.find((service) => service.id === id) ?? null;
}

export function tableOwner(table: string) {
  return SERVICE_CATALOG.find((service) => service.ownedTables.includes(table))?.id ?? null;
}

export function serviceForModule(module: string) {
  return SERVICE_CATALOG.find((service) => service.modules.includes(module))?.id ?? null;
}

export function isExtractable(service: ServiceDefinition) {
  return service.extractionDebt.length === 0;
}

export function serviceTopology() {
  const services = SERVICE_CATALOG.map((service) => ({
    id: service.id,
    name: service.name,
    mission: service.mission,
    runtime: service.runtime,
    ownedTables: service.ownedTables.length,
    modules: service.modules.length,
    publishes: service.publishes,
    extractable: isExtractable(service),
    extractionDebt: service.extractionDebt,
    extractionGate: service.extractionGate,
    benchmark: service.benchmark,
  }));
  return {
    services,
    totals: {
      services: services.length,
      standalone: services.filter((service) => service.runtime === 'standalone').length,
      extractable: services.filter((service) => service.extractable).length,
      ownedTables: services.reduce((total, service) => total + service.ownedTables, 0),
      extractionDebt: services.reduce((total, service) => total + service.extractionDebt.length, 0),
    },
    kernelContract: [...KERNEL_CONTRACT_TABLES],
    posture: 'Servicios con dominio y datos propios desplegados en un runtime compartido. Cada extracción a runtime independiente está condicionada por volumen o riesgo, no por moda arquitectónica, y no se activa infraestructura paga sin autorización.',
  };
}
