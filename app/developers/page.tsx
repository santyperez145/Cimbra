import Link from 'next/link';
import { getCurrentUser } from '@/app/lib/auth/session';
import { ROLE_PROFILES } from '@/app/lib/platform/access-policy';
import { loadApiReference, loadSdkRelease } from '@/app/lib/platform/openapi-reference';
import { API_SCOPES } from '@/app/lib/platform/scopes';
import { WEBHOOK_EVENT_TYPES } from '@/app/lib/platform/webhook-events';
import CopyButton from './copy-button';
import EndpointReference from './endpoint-reference';
import PlatformStatus from './platform-status';

export const metadata = {
  title: 'Developers — API, SDK y webhooks de Cimbra',
  description: 'Contrato OpenAPI, SDK TypeScript descargable, quickstarts y referencia verificable de Cimbra. El entorno actual es sandbox; live permanece fail-closed.',
};

export const dynamic = 'force-dynamic';

const errorResponses = [
  ['400', 'invalid_request', 'Payload, parámetros o Idempotency-Key inválidos.'],
  ['401', 'authentication_required / invalid_api_key', 'Falta la identidad, o la API key es inválida, fue revocada o venció.'],
  ['403', 'insufficient_scope / insufficient_role', 'La identidad existe, pero no tiene el scope o rol requerido.'],
  ['404', 'not_found', 'El recurso no existe dentro del tenant autenticado.'],
  ['409', 'conflict / idempotency_mismatch', 'Conflicto de estado o clave reutilizada con otro payload.'],
  ['422', 'unprocessable_entity', 'La solicitud es válida, pero saldo, riesgo o estado impiden ejecutarla.'],
  ['429', 'rate_limit_exceeded', 'Se agotó la ventana de la API key; respetar Retry-After.'],
  ['5xx', 'internal_error', 'Error transitorio; reintentar sólo cuando Cimbra-Should-Retry sea true.'],
] as const;

const changelog = [
  {
    date: '02 SEP 2026',
    title: 'Consola: ledger, cash-in/out y nav por capability',
    detail: 'Ledger y Cash-in/out operan APIs reales; Book transfers queda separado. La navegación filtra por capability. El SDK agrega approvals.approve/reject/cancel. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Banco patrocinante operable en /ops',
    detail: 'official_rail_connections suma negotiating, evidencia de sponsor (razón social, CUIT, contrato, safeguarding) y due diligence PSPCP. /ops opera PATCH /api/ops/rails/{id}. BIND Banco es candidato a entidad financiera patrocinante; bindX/BIND PSP siguen fuera del core. El adaptador documental no despacha fondos. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Movimientos sobre la API de transferencias',
    detail: 'La consola deja el snapshot del dashboard y opera GET/POST /api/v1/transfers con detalle, paginación, export CSV y reversas compensatorias. Viewer lee; operator/admin/owner escriben. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Auditoría del tenant en la consola',
    detail: 'La consola opera GET /api/v1/events: log append-only, paginado, filtrable por recurso y exportable. Todos los roles leen; no hay mutación. No es un SIEM. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Cuentas de producto en la consola',
    detail: 'La consola opera GET/POST /api/v1/accounts y el statement de 30 días. Alta idempotente sobre un cliente del tenant, una moneda por cuenta y saldo derivado del ledger. Viewer lee; operator/admin/owner abren. No es CBU/CVU. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Padrón de clientes en la consola',
    detail: 'La consola opera GET/POST /api/v1/customers con el mismo contrato del SDK: alta idempotente, last4 fiscal y detalle por id. Viewer lee; operator/admin/owner crean. El KYC/KYB sigue en Compliance. OpenAPI permanece en 193 operaciones.',
  },
  {
    date: '02 SEP 2026',
    title: 'Soporte, organización, superadmin y catálogo de servicios',
    detail: 'API v1 de casos de soporte y perfil del tenant, /ops para operadores provisionados, /help y /status públicos, y GET /api/v1/services con fronteras de dominio verificadas. Runtime compartido: ningún servicio se declara standalone. OpenAPI pasa a 193 operaciones. BIND, Dock, tapi, Pismo, Pomelo y Wibond siguen siendo benchmarks.',
  },
  {
    date: '01 SEP 2026',
    title: 'Data room público y presupuesto Gate 1',
    detail: 'GET /api/v1/live-readiness publica capitalPlan (USD 500, gastado 0, liveReadyAfterSpend=false). /investors muestra evidencia del sandbox sin clientes ni volumen inventados. El envelope no autoriza AWS pago, Coelsa, banco patrocinante ni Go Live. OpenAPI quedó en 179 operaciones en ese corte; el contrato vigente es 193.',
  },
  {
    date: '01 SEP 2026',
    title: 'QR estático del punto de recaudación',
    detail: 'Un collection_till emite su propio cimbra:qr:static:v1 (issueStaticQr o POST /api/v1/collection-tills/{id}/static-qr) sin gastar el QR estático de la cuenta. closedAmountOnly exige una orden de venta pendiente. El pago imputa collectionTillId. El payload no se cancela: se deshabilita el punto. OpenAPI quedó en 179 operaciones en ese corte; el contrato vigente es 193. No es QR interoperable, EMVCo ni POS.',
  },
  {
    date: '01 SEP 2026',
    title: 'Devolución parcial de un link de cobro',
    detail: 'POST /api/v1/payment-links/{id}/refund acepta amount y creditId opcionales. Vacío devuelve lo cobrado pendiente. Un parcial deja postings compensatorios sin mutar el asiento original. Un link CVU puede reabrirse si el neto queda por debajo del monto; internal, QR e inbound permanecen cerrados. GET embebe refunds y partiallyRefunded. OpenAPI sigue en 178 operaciones.',
  },
  {
    date: '01 SEP 2026',
    title: 'Ítems de checkout y créditos embebidos en el link',
    detail: 'POST /api/v1/payment-links acepta items[] informativos (máx. 20). No controlan el monto ni sustituyen un carrito PCI. GET, list y pay embeben items, credits y partiallyCollected. successUrl, errorUrl y configuracionCheckout se rechazan. OpenAPI sigue en 178 operaciones.',
  },
  {
    date: '01 SEP 2026',
    title: 'Créditos parciales CVU y checkout público',
    detail: 'POST /api/v1/payment-links/{id}/pay acepta amount sólo con cimbra_cvu. Se puede acreditar el restante, un parcial, varios créditos o más del monto. checkoutUrl apunta a /pay/{id} sin formulario de tarjeta. QR e internal siguen monto cerrado. collection.link_credited se emite en cada crédito que no completa el link.',
  },
  {
    date: '01 SEP 2026',
    title: 'Link de cobro asociado a deuda QR o till',
    detail: 'POST /api/v1/payment-links acepta qrDebtId y collectionTillId. Los medios cimbra_qr y cimbra_cvu liquidan el QR de la deuda o el CVU del till. Pagar el QR también cierra el link. No hay checkout PCI, tarjeta ni QR de red.',
  },
  {
    date: '01 SEP 2026',
    title: 'Punto de recaudación Cimbra con CVU propio',
    detail: 'POST /api/v1/collection-tills emite un CVU sandbox atribuido al till, no un segundo CVU de la cuenta cobradora. PATCH asigna alias de tenant, POST /inbound acredita el ledger y DELETE deshabilita el CVU. La transferencia interna al CVU queda con collectionTillId. No es caja BIND ni crédito Coelsa.',
  },
  {
    date: '01 SEP 2026',
    title: 'QR de deuda Cimbra',
    detail: 'POST /api/v1/qr-debts crea una deuda con monto cerrado y un solo pago. Payload cimbra:qr:debt:v1. Exige CVU sandbox activo. DELETE la elimina y el QR no se vuelve a pagar. No es deuda BIND, EMVCo ni PCT Coelsa.',
  },
  {
    date: '01 SEP 2026',
    title: 'Orden de venta Cimbra sobre QR estático',
    detail: 'POST /api/v1/qr-sale-orders fija un monto cerrado y un vencimiento sobre un QR estático activo. Una pendiente por QR; crear otra reemplaza la anterior. DELETE la elimina y el QR vuelve a monto abierto. No es caja BIND, EMVCo ni Transferencias 3.0.',
  },
  {
    date: '01 SEP 2026',
    title: 'QR estático Cimbra, reutilizable y sin riel ajeno',
    detail: 'POST /api/v1/payment-qrs con kind=static emite cimbra:qr:static:v1. Exige un CVU sandbox activo, no vence, cobra monto abierto las veces que haga falta y admite un estático activo por cuenta. POST /api/v1/payment-qrs/{id}/cancel deja de cobrar. No es EMVCo, Transferencias 3.0 ni caja BIND.',
  },
  {
    date: '01 SEP 2026',
    title: 'Rieles oficiales y camino PSPCP fail-closed',
    detail: 'GET /api/v1/live-readiness publica el catálogo de contrapartes BCRA/Coelsa/sponsor/PCI, el checklist PSPCP argentino y exige riel live más adaptador Cimbra para liveReady. El sandbox no despacha cámara. Marcar un producto Go Live no mueve fondos.',
  },
  {
    date: '01 SEP 2026',
    title: 'Eliminar CVU sandbox sin tocar la cuenta',
    detail: 'DELETE /api/v1/rail-instruments/{id} deja el CVU y su alias inoperables. La cuenta ARS y el saldo permanecen. Un POST posterior de emisión reactiva el mismo CVU sandbox. No es una baja en Coelsa.',
  },
  {
    date: '01 SEP 2026',
    title: 'Asignar o cambiar alias de un CVU sandbox',
    detail: 'PATCH /api/v1/rail-instruments/{id}/alias asigna o reemplaza el alias de un CVU ya emitido. La unicidad es del tenant, no un directorio nacional. Un cambio real queda limitado a una vez cada 24 horas; emitir el CVU o la primera asignación no arrancan esa ventana. Repetir el mismo alias responde 200 sin mover el reloj.',
  },
  {
    date: '01 SEP 2026',
    title: 'Readiness alineado a BIND, Pismo, Pomelo y tapi',
    detail: 'GET /api/v1/live-readiness deja de inventar gates de software. Expone sandbox vs production como Pismo y BIND, las etapas Integración → Homologación → Go Live de Pomelo, y productos del catálogo público: consulta CBU/CVU/Alias, transferencias, DEBIN, ECHEQ, CVU, QR interoperable, cobro BIND PSP, issuing PCI/BIN y pago de servicios tapi. Production no tiene hostname. Ningún producto está en Go Live.',
  },
  {
    date: '01 SEP 2026',
    title: 'ECHEQ sandbox para Argentina',
    detail: 'Emisión, aceptación, endoso, depósito interno, anulación y devolución previa. Payload cimbra:echeq:v1, CUIT AFIP y rechazo por fondos insuficientes. Descuento, custodia, USD y Coelsa responden 422. No es un cheque compensable en cámara.',
  },
  {
    date: '01 SEP 2026',
    title: 'Cobranzas sandbox para Argentina',
    detail: 'Links de cobro con payload cimbra:link:v1, eco cerrado entre cuentas Cimbra, inbound ledger y devoluciones compensatorias. Tarjetas, POS y QR interoperable responden 422. No es adquirencia de red.',
  },
  {
    date: '01 SEP 2026',
    title: 'Pagos instantáneos sandbox para Argentina',
    detail: 'Emisión de CVU 0009999, alias tenant-scoped, confirmación de titular, crédito interno o cash-out a settlement, débito interno, QR Cimbra dinámico, estático y de deuda con orden de venta y devoluciones compensatorias. No es Coelsa, DEBIN ni QR interoperable.',
  },
  {
    date: '01 SEP 2026',
    title: 'Wallets nativas con bolsillos ledger-backed',
    detail: 'Programas tenant, wallets por customer, pockets mapeados a cuentas de producto, freeze/close, movimientos internos via book transfers, API, SDK, eventos y consola por rol. No custodia fondos ni publica una app de consumidor.',
  },
  {
    date: '30 AGO 2026',
    title: 'Book transfers y estados de cuenta nativos',
    detail: 'Movimientos account-to-account con dos postings atómicos, saldo disponible, holds de riesgo, maker/checker, reversas compensatorias, API paginada, SDK, eventos y consola por rol.',
  },
  {
    date: '30 AGO 2026',
    title: 'Beneficiarios y payouts masivos nativos',
    detail: 'Destinos protegidos por tenant, lotes inmutables de hasta 100 ítems, programación/deadline, maker-checker, worker con lease, riesgo/ledger por ítem, CSV de resultados, scopes, SDK y consola por rol.',
  },
  {
    date: '30 AGO 2026',
    title: 'Servicios, recargas y mandatos recurrentes nativos',
    detail: 'Catálogo por tenant, obligaciones emitidas con referencia protegida, pagos y recargas conectados a ledger/riesgo/holds, reversas compensatorias, mandatos con consentimiento, límites, reintentos, scopes S2S, SDK, eventos y consola por rol.',
  },
  {
    date: '29 AGO 2026',
    title: 'KYC/KYB nativo y maker/checker obligatorio',
    detail: 'Expedientes versionados con partes y beneficiarios finales, checks/evidencia append-only, expiración, scopes S2S, SDK de orquestación, webhooks y consola por rol. La decisión queda reservada a otro Owner/Admin con MFA y sesión humana.',
  },
  {
    date: '29 AGO 2026',
    title: 'Step-up OTP y SLO de decisión',
    detail: 'Challenges client-managed con secreto cifrado y hasheado, expiración, intentos append-only, idempotencia, RBAC, auditoría y SDK. Riesgo publica p50/p95/p99 y cumplimiento medido; no se presenta como 3DS o ACS.',
  },
  {
    date: '29 AGO 2026',
    title: 'Disputas y chargebacks nativos',
    detail: 'Disputas parciales con lifecycle explícito, créditos provisionales o definitivos en doble partida, compensaciones, evidencia, cola operativa, maker/checker, API, SDK y permisos por rol. network_ready no implica conexión a una red real.',
  },
  {
    date: '29 AGO 2026',
    title: 'Runtime verificable y métricas por período',
    detail: 'El build valida el servidor standalone usado por OCI y el overview calcula ventanas reales de 7/30 días; los fallos de red o respuestas inválidas ya no dejan acciones bloqueadas.',
  },
  {
    date: '29 AGO 2026',
    title: 'Issuing nativo: programas, lifecycle y controles',
    detail: 'Programas tenant, estados terminales, controles append-only por límites/canales/MCC, seis eventos, SDK y consola por rol; el sandbox no expone datos PCI ni afirma conexión a redes.',
  },
  {
    date: '29 AGO 2026',
    title: 'Doble control para decisiones operativas',
    detail: 'Casos de riesgo, excepciones de conciliación y disputas admiten políticas independientes, revalidación atómica y protección contra bypass de holds o créditos.',
  },
  {
    date: '29 AGO 2026',
    title: 'Cola operativa con SLA y evidencia',
    detail: 'Riesgo, conciliación y disputas comparten ownership, prioridad, vencimiento, escalamiento, comentarios y documentos privados mediante API, SDK y consola.',
  },
  {
    date: '29 AGO 2026',
    title: 'RBAC y sesiones consistentes',
    detail: 'Una matriz canónica gobierna consola y API; 401 y 403 quedan diferenciados y las sesiones vencidas preservan el destino.',
  },
  {
    date: '29 AGO 2026',
    title: 'Maker/checker para transferencias y settlement',
    detail: 'Solicitudes persistidas, separación de personas, MFA, expiración y revalidación transaccional antes de ejecutar.',
  },
  {
    date: '28 AGO 2026',
    title: 'Riesgo, conciliación y settlement nativos',
    detail: 'Reglas, evaluaciones, casos, importación CSV, excepciones y ciclos sandbox conectados al ledger y a webhooks.',
  },
] as const;

function CodeBlock({ language, value }: { language: string; value: string }) {
  return <div className="docs-code">
    <div><b>{language}</b><CopyButton value={value} /></div>
    <pre><code>{value}</code></pre>
  </div>;
}

export default async function DevelopersPage() {
  const [user, reference] = await Promise.all([getCurrentUser(), Promise.resolve(loadApiReference())]);
  const sdk = loadSdkRelease();
  const sdkDownloadUrl = `${reference.baseUrl}${sdk.downloadPath}`;
  const sdkInstall = `npm install ${sdkDownloadUrl}`;
  const curlQuickstart = `curl --request POST \\
  --url ${reference.baseUrl}/api/v1/customers \\
  --header "Authorization: Bearer \$CIMBRA_API_KEY" \\
  --header "Content-Type: application/json" \\
  --header "Idempotency-Key: customer-quickstart-001" \\
  --header "X-Request-Id: req_quickstart_001" \\
  --data '{
    "type": "business",
    "name": "Comercio del Sur",
    "country": "AR",
    "taxId": "30712345678"
  }'`;
  const sdkQuickstart = `import { Cimbra } from '@cimbra/sdk';

const cimbra = new Cimbra({
  apiKey: process.env.CIMBRA_API_KEY!,
  baseUrl: '${reference.baseUrl}',
});

const result = await cimbra.customers.create({
  type: 'business',
  name: 'Comercio del Sur',
  country: 'AR',
  taxId: '30712345678',
});

console.log(result.data.customer.id, result.requestId);`;
  const customerResponse = `{
  "ok": true,
  "customer": {
    "id": "<uuid>",
    "type": "business",
    "name": "Comercio del Sur",
    "country": "AR",
    "taxIdLast4": "5678",
    "status": "active",
    "createdAt": "<ISO-8601>"
  },
  "replayed": false
}`;
  const webhookPayload = `{
  "id": "<event_uuid>",
  "type": "transfer.created",
  "created_at": "<ISO-8601>",
  "data": {
    "resource_type": "transaction",
    "resource_id": "<transaction_uuid>"
  }
}`;
  const webhookVerification = `import { constructWebhookEvent } from '@cimbra/sdk';

const rawBody = await request.text();
const event = await constructWebhookEvent({
  payload: rawBody,
  signature: request.headers.get('cimbra-signature')!,
  timestamp: request.headers.get('cimbra-timestamp'),
  secret: process.env.CIMBRA_WEBHOOK_SECRET!,
});

console.log(event.id, event.type, event.created_at);
return new Response(null, { status: 204 });`;
  const structuredError = `{
  "error": {
    "type": "cimbra_api_error",
    "code": "insufficient_scope",
    "message": "La API key no incluye el scope customers:write.",
    "requestId": "req_<id>"
  }
}`;
  const riskStepUpExample = `const evaluationId = '<evaluation_in_review_uuid>';
const created = await cimbra.risk.createStepUpChallenge(evaluationId, {
  expiresInSeconds: 300,
  maxAttempts: 5,
});

// Entregá esta credencial desde tu backend por un canal aprobado.
const credential = created.data.credential!;

const result = await cimbra.risk.verifyStepUpChallenge(
  evaluationId,
  created.data.challenge.id,
  { credential },
);

console.log(result.data.verified, result.data.challenge.status);`;
  const dueDiligenceExample = `const opened = await cimbra.dueDiligence.create({
  customerId: '<business_customer_uuid>',
  expiresInDays: 90,
});

await cimbra.dueDiligence.addParty(opened.data.case.id, {
  role: 'beneficial_owner',
  name: 'Ana Sur',
  taxId: '20123456789',
  ownershipPercentage: 25,
});

await cimbra.dueDiligence.recordCheck(opened.data.case.id, {
  checkType: 'sanctions',
  source: 'official_registry',
  status: 'passed',
  resultCode: 'no_match',
  note: 'Consulta directa documentada.',
});

// Completá todos los checks/partes exigidos antes de enviar.
await cimbra.dueDiligence.submit(opened.data.case.id);`;
  const billerPaymentsExample = `const biller = await cimbra.billers.create({
  code: 'ENERGIA_AR',
  name: 'Energía Regional',
  country: 'AR',
  category: 'utilities',
  serviceType: 'bill_payment',
  currency: 'ARS',
  amountMode: 'exact',
  contractReference: 'DIRECT-2026-001',
});

const debt = await cimbra.billers.createObligation(biller.data.biller.id, {
  externalReference: 'INV-2026-0001',
  subscriberReference: 'CLIENTE-00123456',
  amount: '18250.00',
  dueAt: '2026-09-10T21:00:00.000Z',
  description: 'Servicio agosto 2026',
});

const payment = await cimbra.billPayments.create({
  accountId: '<account_uuid>',
  billerId: biller.data.biller.id,
  obligationId: debt.data.obligation.id,
});

console.log(payment.data.order.status);`;
  const payoutExample = `const beneficiary = await cimbra.payoutBeneficiaries.create({
  externalReference: 'PROVIDER-001',
  name: 'Proveedor Regional',
  entityType: 'business',
  country: 'AR',
  currency: 'ARS',
  destinationType: 'alias',
  destination: 'proveedor.cimbra',
});

const batch = await cimbra.payoutBatches.create({
  sourceAccountId: '<account_uuid>',
  externalReference: 'PAYOUT-2026-09-001',
  description: 'Liquidación de proveedores',
  currency: 'ARS',
  processBefore: '2026-09-01T21:00:00.000Z',
  items: [{
    externalReference: 'ITEM-001',
    beneficiaryId: beneficiary.data.beneficiary.id,
    amount: '125000.00',
    description: 'Liquidación agosto',
  }],
});

const submitted = await cimbra.payoutBatches.submit(batch.data.batch.id);
const csv = await cimbra.payoutBatches.resultCsv(batch.data.batch.id);
console.log(submitted.data.batch.status, csv.data);`;
  const bookTransferExample = `const movement = await cimbra.bookTransfers.create({
  externalReference: 'BT-2026-0001',
  sourceAccountId: '<source_account_uuid>',
  destinationAccountId: '<destination_account_uuid>',
  description: 'Distribución de saldo marketplace',
  amount: '1250.00',
  currency: 'ARS',
});

if (!movement.data.requiresApproval) {
  const statement = await cimbra.accounts.statement(movement.data.transfer.sourceAccountId, {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    limit: 50,
  });
  console.log(statement.data.period.closingBalance, statement.data.data);
}`;
  const walletExample = `const program = await cimbra.walletPrograms.create({
  name: 'Wallet marketplace ARS',
  displayName: 'Billetera Comercio Sur',
  defaultCurrency: 'ARS',
  pocketKinds: ['available', 'pending'],
});

const wallet = await cimbra.wallets.create({
  programId: program.data.program.id,
  customerId: '<customer_uuid>',
  externalReference: 'WALLET-001',
});

const movement = await cimbra.wallets.transfer(wallet.data.wallet.id, {
  externalReference: 'WP-001',
  sourcePocketId: wallet.data.pockets[0].id,
  destinationPocketId: wallet.data.pockets[1].id,
  description: 'Reserva operativa',
  amount: '25.00',
  currency: 'ARS',
});`;
  const instantExample = `const issued = await cimbra.railInstruments.issue({
  accountId: '<account_uuid>',
});
await cimbra.railInstruments.assignAlias(issued.data.instruments[0].id, {
  alias: 'COMERCIO.SUR',
});
const preview = await cimbra.railDirectory.lookup(issued.data.instruments[0].value);
const credit = await cimbra.instantTransfers.create({
  externalReference: 'IP-001',
  accountId: '<source_account_uuid>',
  destination: issued.data.instruments[0].value,
  description: 'Cobro inmediato',
  amount: '1500.00',
  currency: 'ARS',
  confirmHolder: true,
  holderName: preview.data.holderName!,
  taxIdLast4: preview.data.taxIdLast4!,
});
const staticQr = await cimbra.paymentQrs.create({
  accountId: '<account_uuid>',
  description: 'Mostrador',
  kind: 'static',
});
await cimbra.qrSaleOrders.create({
  paymentQrId: staticQr.data.qr.id,
  externalReference: 'OV-001',
  description: 'Ticket mostrador',
  amount: '1500.00',
});
const debt = await cimbra.qrDebts.create({
  accountId: '<account_uuid>',
  externalReference: 'DEUDA-001',
  description: 'Cuota única',
  amount: '2500.00',
});`;
  const collectionsExample = `const till = await cimbra.collectionTills.create({
  accountId: '<merchant_account_uuid>',
  externalReference: 'TILL-001',
  name: 'Mostrador Sur',
  issueStaticQr: true,
  closedAmountOnly: true,
});
await cimbra.qrSaleOrders.create({
  paymentQrId: till.data.till.paymentQrId!,
  externalReference: 'OV-TILL-001',
  description: 'Ticket mostrador',
  amount: '1500.00',
});
await cimbra.collectionTills.inbound(till.data.till.id, {
  externalReference: 'INB-001',
  description: 'Transferencia recibida',
  amount: '1500.00',
});
const link = await cimbra.paymentLinks.create({
  accountId: '<merchant_account_uuid>',
  externalReference: 'FAC-001',
  description: 'Honorarios agosto',
  amount: '18500.00',
  currency: 'ARS',
  methods: ['cimbra_qr', 'cimbra_cvu'],
  qrDebtId: '<qr_debt_uuid>',
  collectionTillId: till.data.till.id,
  items: [{ description: 'Honorarios agosto', amount: '18500.00', quantity: 1 }],
});
await cimbra.paymentLinks.pay(link.data.link.id, {
  method: 'cimbra_qr',
  payerAccountId: '<payer_account_uuid>',
});
await cimbra.paymentLinks.refund(link.data.link.id, { amount: '3.00' });`;

  return <main className="docs-shell docs-shell-expanded">
    <header className="docs-topbar">
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <span className="docs-product">DEVELOPER PLATFORM</span>
      <div>
        <PlatformStatus />
        <Link href="/help">Ayuda</Link>
        <Link href="/status">Status</Link>
        <Link href="/openapi.yaml">OpenAPI</Link>
        {user ? <Link className="docs-cta" href="/console">Abrir consola ↗</Link> : <Link className="docs-cta" href="/login?return_to=%2Fconsole">Ingresar ↗</Link>}
      </div>
    </header>

    <aside className="docs-sidebar">
      <nav aria-label="Documentación">
        <strong>COMENZAR</strong>
        <a className="active" href="#overview">Descripción general</a>
        <a href="#environments">Entornos y disponibilidad</a>
        <a href="#quickstart">Quickstart real</a>
        <strong>CONCEPTOS</strong>
        <a href="#authentication">Autenticación y acceso</a>
        <a href="#idempotency">Idempotencia y reintentos</a>
        <a href="#pagination">Paginación y dinero</a>
        <a href="#errors">Errores y rate limits</a>
        <strong>INTEGRACIÓN</strong>
        <a href="#sdk">SDK TypeScript</a>
        <a href="#book-transfers">Book transfers</a>
        <a href="#wallets">Wallets</a>
        <a href="#instant-payments">Pagos AR</a>
        <a href="#collections">Cobranzas</a>
        <a href="#payouts">Payouts masivos</a>
        <a href="#billers">Servicios y recargas</a>
        <a href="#due-diligence">KYC/KYB</a>
        <a href="#risk-step-up">Step-up y SLO</a>
        <a href="#webhooks">Webhooks y eventos</a>
        <a href="#reference">Referencia completa</a>
        <a href="#changelog">Changelog</a>
      </nav>
      <div className="docs-version"><span>API {reference.version}</span><b>SDK {sdk.version}</b></div>
    </aside>

    <article className="docs-content docs-content-expanded">
      <details className="docs-mobile-nav">
        <summary>Índice de documentación</summary>
        <nav><a href="#overview">Overview</a><a href="#quickstart">Quickstart</a><a href="#authentication">Auth</a><a href="#sdk">SDK</a><a href="#book-transfers">Book transfers</a><a href="#wallets">Wallets</a><a href="#instant-payments">Pagos AR</a><a href="#collections">Cobranzas</a><a href="#payouts">Payouts</a><a href="#billers">Servicios</a><a href="#due-diligence">KYC/KYB</a><a href="#risk-step-up">Step-up</a><a href="#webhooks">Webhooks</a><a href="#reference">API reference</a></nav>
      </details>

      <section id="overview" className="docs-hero">
        <div className="docs-breadcrumb">DOCUMENTACIÓN <span>/</span> API V1</div>
        <p className="eyebrow"><span /> CONTRATO VERIFICABLE</p>
        <h1>Integrá sobre cosas<br />que existen.</h1>
        <p className="docs-lede">Esta documentación se construye desde el mismo OpenAPI que publica Cimbra y describe únicamente el sandbox desplegado: autenticación, recursos, SDK, errores, eventos y límites operativos reales.</p>
        <div className="docs-proof-grid" aria-label="Evidencia técnica publicada">
          <article><strong>OpenAPI 3.1</strong><span>Contrato descargable</span></article>
          <article><strong>{reference.operations.length}</strong><span>Operaciones documentadas</span></article>
          <article><strong>{API_SCOPES.length}</strong><span>Scopes S2S canónicos</span></article>
          <article><strong>{WEBHOOK_EVENT_TYPES.length}</strong><span>Tipos de evento emitidos</span></article>
        </div>
        <div className="docs-callout"><i>i</i><div><strong>Entorno sandbox, contrato de producción</strong><p>Customers, KYC/KYB, cuentas, wallets, book transfers, estados de cuenta, tarjetas, beneficiarios, lotes de payouts, servicios, obligaciones, recargas, mandatos, movimientos, ledger, riesgo, conciliación, disputas, operaciones, aprobaciones, soporte, organización, topología de servicios y webhooks se persisten sobre el núcleo real. El host activo es sandbox, como sandbox.bind.com.ar, sandbox.pismolabs.io y sandbox.api.pomelo.la. Live exige hostname de producción, producto en Go Live, rieles oficiales BCRA/Coelsa/sponsor en live y un adaptador Cimbra registrado.</p></div></div>
      </section>

      <section id="environments" className="docs-section">
        <p className="docs-kicker">ENTORNOS</p><h2>Un contrato. Un entorno activo. Live fail-closed.</h2>
        <div className="environment-grid">
          <article className="environment-card available"><div><i /> ENTORNO ACTIVO · SANDBOX</div><code>{reference.baseUrl}</code><p>Misma API, ledger y eventos que producción. Las claves usan <code>cim_sk_test_</code>. No mueve fondos de riel.</p><a href="/api/health">Consultar healthcheck JSON ↗</a></article>
          <article className="environment-card unavailable"><div><i /> LIVE</div><strong>Hostname no provisionado</strong><p>Pismo entrega el hostname de producción en el onboarding comercial. BIND APIBANK no publica la URL productiva. Pomelo usa <code>api.pomelo.la</code> después de homologar. Hasta entonces no hay <code>cim_sk_live_</code>.</p><span>Consultar <code>GET /api/v1/live-readiness</code></span></article>
        </div>
        <div className="artifact-matrix">
          <div><span>OpenAPI YAML</span><b className="available">Disponible</b><a href="/openapi.yaml">Descargar</a></div>
          <div><span>SDK TypeScript {sdk.version}</span><b className="preview">Preview verificable</b><a href={sdk.downloadPath}>Descargar</a></div>
          <div><span>Postman Collection</span><b className="unavailable">No publicada</b><span>Backlog</span></div>
          <div><span>SDKs Java / Python / Go</span><b className="unavailable">No publicados</b><span>Backlog</span></div>
        </div>
      </section>

      <section id="quickstart" className="docs-section">
        <p className="docs-kicker">QUICKSTART</p><h2>Primer request, sin pasos inventados.</h2>
        <p className="docs-section-lede">Una API key sólo puede ser creada por Owner o Admin desde la sección Developers de la consola. El secreto se muestra una vez y Cimbra conserva únicamente su hash.</p>
        <div className="quickstart-steps">
          <article><span>01</span><div><strong>Entrá a la consola</strong><p>{user ? `Tu sesión está activa como ${user.displayName}. Abrí Developers y generá una clave con customers:write.` : 'Iniciá sesión, abrí Developers y generá una clave con customers:write.'}</p><Link href={user ? '/console' : '/login?return_to=%2Fconsole'}>{user ? 'Abrir consola' : 'Ingresar'} ↗</Link></div></article>
          <article><span>02</span><div><strong>Guardá el secreto en backend</strong><p>Usá una variable de entorno. Nunca expongas la clave en navegador, app móvil, repositorio o logs.</p><code>CIMBRA_API_KEY=cim_sk_test_••••</code></div></article>
          <article><span>03</span><div><strong>Creá un customer</strong><p>Mandá una clave de idempotencia estable por operación lógica. El identificador y el tenant se resuelven en servidor.</p></div></article>
        </div>
        <CodeBlock language="CURL · EJECUTABLE" value={curlQuickstart} />
        <p className="docs-code-caption">Respuesta real: HTTP 201 en la primera creación y HTTP 200 con <code>Idempotent-Replayed: true</code> al repetir exactamente el request.</p>
        <CodeBlock language="JSON · 201 CREATED" value={customerResponse} />
      </section>

      <section id="authentication" className="docs-section">
        <p className="docs-kicker">AUTENTICACIÓN Y AUTORIZACIÓN</p><h2>Dos identidades, controles distintos.</h2>
        <div className="auth-mode-grid">
          <article><span>HUMANOS</span><h3>Sesión first-party</h3><p>Cookie opaca, hasheada en servidor. RBAC decide qué puede ver y ejecutar cada rol; las mutaciones validan origen y las decisiones maker/checker requieren sesión humana.</p><code>__Host-cimbra_session</code></article>
          <article><span>MACHINE-TO-MACHINE</span><h3>API key con scopes</h3><p>Bearer propio del tenant, revocable, con vencimiento y rate limit. No puede aprobar, rechazar ni cancelar solicitudes maker/checker.</p><code>Authorization: Bearer cim_sk_test_…</code></article>
        </div>
        <div className="role-contract-grid">
          {Object.entries(ROLE_PROFILES).map(([role, profile]) => <article key={role}><div><strong>{profile.label}</strong><span>{profile.posture}</span></div><p>{profile.description}</p>{role === 'owner' || role === 'admin' ? <b>Puede administrar API keys</b> : <b>No administra credenciales</b>}</article>)}
        </div>
        <div className="docs-scope-cloud" aria-label="Scopes disponibles">
          {API_SCOPES.map((scope) => <code key={scope}>{scope}</code>)}
        </div>
        <div className="docs-note"><strong>401 ≠ 403</strong><p><code>401</code> significa que la identidad no fue autenticada. <code>403</code> significa que existe una sesión o API key válida, pero su rol o scope no permite esa operación.</p></div>
      </section>

      <section id="idempotency" className="docs-section docs-contract-section">
        <p className="docs-kicker">CONTRATO HTTP</p><h2>Idempotencia, trazabilidad y retry seguro.</h2>
        <div className="contract-grid">
          <article><span>01</span><h3>Idempotency-Key</h3><p>Obligatoria cuando el endpoint la declara: altas y movimientos reintentables. Admite 8–100 caracteres de <code>A-Z a-z 0-9 . _ : -</code>.</p></article>
          <article><span>02</span><h3>X-Request-Id</h3><p>Podés enviarlo; si falta, Cimbra lo genera. Se devuelve en toda respuesta y el SDK lo conserva durante reintentos.</p></article>
          <article><span>03</span><h3>Replays</h3><p>Misma clave y mismo payload: respuesta original y header <code>Idempotent-Replayed: true</code>. Payload distinto: HTTP 409.</p></article>
          <article><span>04</span><h3>Cimbra-Should-Retry</h3><p>La API marca explícitamente si un error puede reintentarse. El SDK aplica backoff sólo en requests seguros.</p></article>
        </div>
        <div className="docs-note warning"><strong>Límite actual</strong><p>Configuración de webhooks, carga de evidencia y desactivación de reglas todavía no ofrecen replay idempotente; el SDK no las reintenta. La referencia de cada operación indica si acepta <code>Idempotency-Key</code>.</p></div>
      </section>

      <section id="pagination" className="docs-section">
        <p className="docs-kicker">MODELO DE DATOS</p><h2>Cursores estables y montos exactos.</h2>
        <div className="data-contract-grid">
          <article><h3>Paginación</h3><p>Customers, accounts, account statements, cards, transfers, book transfers y events aceptan <code>limit</code> entre 1 y 100. Reutilizá <code>nextCursor</code> mientras <code>hasMore</code> sea true.</p><pre><code>{`{
  "data": [/* recursos */],
  "hasMore": true,
  "nextCursor": "<base64url_opaco>"
}`}</code></pre></article>
          <article><h3>Dinero</h3><p>En requests, enviá montos como string decimal en unidad mayor. En respuestas financieras, <code>amountMinor</code> conserva la representación contable exacta como string.</p><pre><code>{`{
  "amount": "1250.50",
  "amountMinor": "125050",
  "currency": "ARS"
}`}</code></pre></article>
        </div>
        <p className="docs-code-caption">Monedas modeladas: ARS, USD, MXN, COP, BRL, CLP y PEN. Esto no implica disponibilidad de rieles reales en esos países.</p>
      </section>

      <section id="errors" className="docs-section">
        <p className="docs-kicker">ERRORES Y LÍMITES</p><h2>Fallos estructurados y accionables.</h2>
        <CodeBlock language="JSON · ERROR EN API V1" value={structuredError} />
        <div className="error-contract-table">
          {errorResponses.map(([status, code, meaning]) => <div key={status}><b>{status}</b><code>{code}</code><span>{meaning}</span></div>)}
        </div>
        <div className="docs-note"><strong>Rate limit efectivo</strong><p>Las API keys nuevas tienen hoy un límite de <code>300 requests/minuto</code>. Después de autorizar la API key, las respuestas incluyen <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code> y <code>X-RateLimit-Reset</code>. Un 429 agrega <code>Retry-After: 60</code>.</p></div>
      </section>

      <section id="sdk" className="docs-section">
        <p className="docs-kicker">SDK TYPESCRIPT</p><h2>Un paquete real, descargable y con checksum.</h2>
        <div className="sdk-release-card">
          <div><span>PREVIEW OFICIAL</span><h3>{sdk.name} · v{sdk.version}</h3><p>Node.js 20+. ESM, declaraciones TypeScript, source maps, timeouts, errores tipados, cursores, reintentos seguros y verificación de webhooks.</p></div>
          <div><a href={sdk.downloadPath}>Descargar .tgz ↗</a><a href={sdk.downloadPath.replace('.tgz', '.sha256')}>SHA-256 ↗</a><small>{(sdk.sizeBytes / 1024).toFixed(1)} kB · licencia propietaria</small></div>
        </div>
        <div className="docs-note warning"><strong>Distribución honesta</strong><p>El SDK todavía no está en npm. El comando instala el artefacto servido por Cimbra; el checksum publicado permite verificar exactamente qué paquete se recibió.</p></div>
        <CodeBlock language="TERMINAL" value={sdkInstall} />
        <div className="sdk-checksum"><span>SHA-256</span><code>{sdk.sha256}</code><CopyButton value={sdk.sha256} label="Copiar hash" /></div>
        <CodeBlock language="TYPESCRIPT" value={sdkQuickstart} />
      </section>

      <section id="billers" className="docs-section">
        <p className="docs-kicker">BILLER INFRASTRUCTURE</p><h2>Servicios propios, no un adaptador a competidores.</h2>
        <p className="docs-section-lede">El originador directo registra su catálogo y emite obligaciones dentro del tenant. Cimbra protege la referencia del suscriptor, ejecuta el pago o la recarga contra el mismo ledger y riesgo del core, y conserva todo el lifecycle para conciliación, reversa y eventos.</p>
        <div className="webhook-contract-grid">
          <article><strong>Contrato S2S</strong><p><code>billers:read/write</code> gobierna catálogo y deuda; <code>payments:read/write</code> gobierna órdenes y mandatos.</p></article>
          <article><strong>Dinero consistente</strong><p>Una orden comparte ledger de doble partida, límites, evaluación de riesgo y holds. La reversa crea postings compensatorios.</p></article>
          <article><strong>Recurrencia controlada</strong><p>Mandatos semanales o mensuales conservan consentimiento, límite por ejecución, agenda, reintentos y pausa/cancelación.</p></article>
          <article><strong>Límite real</strong><p>El sandbox no consulta una deuda externa ni afirma cobertura. Producción exige contrato directo, consentimiento exigible, riel oficial y certificación por país.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={billerPaymentsExample} />
      </section>

      <section id="book-transfers" className="docs-section">
        <p className="docs-kicker">CORE BANKING</p><h2>Un movimiento, dos postings, historial completo.</h2>
        <p className="docs-section-lede">Un book transfer mueve saldo entre dos cuentas activas del mismo tenant y moneda. Cimbra bloquea ambos recursos, descuenta reservas del saldo disponible y crea el débito y crédito dentro de la misma transacción SQL.</p>
        <div className="webhook-contract-grid">
          <article><strong>Atomicidad</strong><p>La operación nunca deja un solo leg: el journal exige débitos iguales a créditos y el trigger protege tenant y moneda.</p></article>
          <article><strong>Riesgo y doble control</strong><p>Una decisión <code>review</code> reserva sólo el origen. La política <code>transfer.create</code> puede exigir un checker distinto con MFA antes de crear el movimiento.</p></article>
          <article><strong>Estados de cuenta</strong><p><code>accounts:read</code> devuelve postings paginados, saldo de apertura y cierre para un período máximo de 366 días.</p></article>
          <article><strong>Reversas</strong><p>Una reversa crea postings opuestos y queda enlazada; jamás edita ni borra el asiento original.</p></article>
        </div>
        <div className="docs-callout"><i>i</i><div><strong>Rail interno, no transferencia bancaria</strong><p>El contrato está operativo dentro del sandbox persistente. Pix, SPEI, CBU/CVU u otros rieles externos requieren una conexión directa homologada, licencia o sponsor y conciliación oficial por país.</p></div></div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={bookTransferExample} />
      </section>

      <section id="wallets" className="docs-section">
        <p className="docs-kicker">EMBEDDED FINANCE</p><h2>Una wallet, bolsillos reales, sin ledger paralelo.</h2>
        <p className="docs-section-lede">Un programa tenant configura marca y kinds de bolsillo. Abrir una wallet crea cuentas de producto; mover saldo entre pockets ejecuta un book transfer con riesgo, holds y maker/checker.</p>
        <div className="webhook-contract-grid">
          <article><strong>Programas</strong><p>Owner/Admin define nombre visible, moneda, bolsillos <code>available</code>, <code>pending</code> o <code>rewards</code> y URLs de soporte. No se publica una app de consumidor.</p></article>
          <article><strong>Pockets</strong><p>Cada bolsillo es una cuenta de producto. El saldo se deriva de postings; freeze y close inactivan esas cuentas.</p></article>
          <article><strong>Movimientos</strong><p><code>wallets:write</code> resuelve pocket IDs y reutiliza el rail interno. Una wallet inactiva rechaza el movimiento con <code>409</code>.</p></article>
          <article><strong>Límite real</strong><p>El sandbox no custodia fondos. Una wallet productiva exige marco PSP o entidad habilitada, safeguarding y riel de fondeo por país.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={walletExample} />
      </section>

      <section id="instant-payments" className="docs-section">
        <p className="docs-kicker">ARGENTINA · SANDBOX</p><h2>CVU propio, alias de tenant, sin fingir Coelsa.</h2>
        <p className="docs-section-lede">Cimbra emite CVU con prefijo 000 y código PSP 9999, asigna o cambia el alias del tenant sobre un CVU existente, confirma titular y liquida el crédito interno sobre el ledger. Un CBU externo sale a settlement. El débito y el QR sólo operan entre cuentas del tenant.</p>
        <div className="webhook-contract-grid">
          <article><strong>Instrumentos</strong><p>Un CVU por cuenta ARS argentina. El alias se asigna o cambia sobre ese CVU; es único en el tenant y un cambio real queda bloqueado 24 horas. Eliminar el CVU no borra la cuenta ni el saldo. No se emite CBU porque Cimbra no es banco.</p></article>
          <article><strong>Confirmación</strong><p>El crédito exige <code>confirmHolder</code>, nombre y últimos cuatro del CUIT. Un mismatch interno responde <code>422 holder_mismatch</code>.</p></article>
          <article><strong>Débito y QR</strong><p>El débito externo responde <code>external_debit_not_supported</code>. El dinámico <code>cimbra:qr:v1</code> vence y se consume; el estático <code>cimbra:qr:static:v1</code> es reutilizable. Una orden de venta fija el monto cerrado sobre ese QR. El QR de deuda <code>cimbra:qr:debt:v1</code> es un recurso primario de un solo pago.</p></article>
          <article><strong>Límite real</strong><p>Transferencias 3.0, DEBIN y directorio nacional entran con membresía o sponsor directo. BIND y el resto siguen como benchmarks, no conectores.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={instantExample} />
      </section>

      <section id="collections" className="docs-section">
        <p className="docs-kicker">ARGENTINA · COBRANZAS</p><h2>Un link de cobro y un punto de recaudación, sin fingir adquirencia de red.</h2>
        <p className="docs-section-lede">El comercio emite un link contra una cuenta ARS argentina, opcionalmente asociado a una deuda QR abierta o a un punto de recaudación. El pagador liquida desde otra cuenta Cimbra, con inbound sandbox, pagando el QR de la deuda o acreditando el CVU del till. La devolución usa postings compensatorios: total o parcial. Un link CVU puede reabrirse si el neto queda por debajo del monto; no se reabre la deuda QR.</p>
        <div className="webhook-contract-grid">
          <article><strong>Link</strong><p>Monto, vencimiento y payload <code>cimbra:link:v1</code>. Puede llevar <code>qrDebtId</code>, <code>collectionTillId</code> e <code>items</code> de detalle. GET embebe <code>credits</code>, <code>refunds</code>, <code>partiallyCollected</code> y <code>partiallyRefunded</code>. Owner/Admin/Operator crean y devuelven; Viewer sólo consulta.</p></article>
          <article><strong>Punto de recaudación</strong><p><code>collection_tills</code> emite un CVU <code>000+9999</code> del till. Transferencias internas e inbound quedan con <code>collectionTillId</code>. No es caja BIND.</p></article>
          <article><strong>Scopes</strong><p><code>payments:read/write</code> protege S2S. El cobro entra al motor de riesgo y puede quedar en hold.</p></article>
          <article><strong>Límite real</strong><p>No hay checkout PCI, marcas, sucursales ni liquidación a un adquirente. El cobro por CVU admite parciales, overpay y devolución parcial; QR e internal siguen monto cerrado. Un inbound suelto al till no imputa el link. El CVU del till no viaja por Coelsa. BIND y el resto siguen como benchmarks, no conectores.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={collectionsExample} />
      </section>

      <section id="payouts" className="docs-section">
        <p className="docs-kicker">PAYOUT INFRASTRUCTURE</p><h2>De un beneficiario protegido a un resultado conciliable.</h2>
        <p className="docs-section-lede">Cimbra acepta un lote como borrador inmutable, lo somete a doble control si el tenant lo exige y procesa cada ítem por separado. Un fallo funcional no duplica ni bloquea los payouts ya resueltos; el estado y el archivo se derivan de datos persistidos.</p>
        <div className="docs-callout"><i>i</i><div><strong>Scheduling del entorno actual</strong><p>Los lotes inmediatos se despachan al responder. En el deployment gratuito actual, el recovery sweep de lotes programados corre diariamente y no promete precisión horaria; la infraestructura AWS preparada usa EventBridge cada minuto, pero no se activa hasta autorizar presupuesto.</p></div></div>
        <div className="webhook-contract-grid">
          <article><strong>Scopes y roles</strong><p><code>payouts:read/write</code> protege S2S. Owner/Admin administra destinos, Operator puede crear/enviar lotes y Viewer sólo consulta.</p></article>
          <article><strong>Privacidad</strong><p>El destino completo es write-only: se normaliza, se convierte en digest tenant-scoped y sólo vuelven tipo y últimos cuatro.</p></article>
          <article><strong>Ejecución durable</strong><p>De 1 a 100 ítems, programación y deadline, lease recuperable, tres intentos transitorios, riesgo, saldo, holds y ledger por ítem.</p></article>
          <article><strong>Límite real</strong><p>El sandbox contabiliza contra settlement interno. Producción requiere riel bancario/cámara directo, reason codes, returns, conciliación y homologación.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={payoutExample} />
      </section>

      <section id="due-diligence" className="docs-section">
        <p className="docs-kicker">CUSTOMER DUE DILIGENCE</p><h2>KYC/KYB orquestado, con decisión humana independiente.</h2>
        <p className="docs-section-lede">El tipo del customer determina KYC o KYB. Cada caso congela jurisdicción, versión de política y checks requeridos; partes, evidencia y observaciones se conservan append-only y el vencimiento es terminal.</p>
        <div className="webhook-contract-grid">
          <article><strong>Preparación S2S</strong><p><code>compliance:read/write</code> permite crear, completar, consultar, enviar o cancelar un expediente desde backend.</p></article>
          <article><strong>KYB completo</strong><p>Exige representante legal y al menos un beneficiario final; la participación declarada total no puede superar 100%.</p></article>
          <article><strong>Maker / checker</strong><p>Aprobar o rechazar es session-only: otro Owner/Admin con MFA decide y una API key recibe <code>403 session_required</code>.</p></article>
          <article><strong>Límite real</strong><p>El sandbox no afirma biometría, prueba de vida, listas o registros oficiales sin una fuente directa certificada.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={dueDiligenceExample} />
      </section>

      <section id="risk-step-up" className="docs-section">
        <p className="docs-kicker">RISK STEP-UP</p><h2>Autenticación reforzada, sin confundirla con una red.</h2>
        <p className="docs-section-lede">Una evaluación <code>review</code> puede abrir un challenge OTP. Cimbra genera la credencial, conserva hash y ciphertext, limita intentos, expira el challenge y registra cada intento sin guardar el código en claro. El integrador recibe la credencial sólo en el create/replay pendiente y la entrega desde backend por su canal aprobado.</p>
        <div className="webhook-contract-grid">
          <article><strong>Lifecycle</strong><p><code>pending → verified | failed | expired</code>. Un challenge terminal no se reabre.</p></article>
          <article><strong>Interconexión</strong><p>La verificación queda vinculada a la evaluación y al caso; no resuelve fondos ni evita maker/checker.</p></article>
          <article><strong>SLO medido</strong><p>El estado de riesgo publica muestras, p50, p95, p99 y porcentaje ≤ 250 ms de decisiones nuevas.</p></article>
          <article><strong>Límite real</strong><p>No implementa EMV 3DS, ACS, liability shift, SMS, push ni biometría. Esas capas requieren canal, riel y certificación directos.</p></article>
        </div>
        <CodeBlock language="TYPESCRIPT · SDK REAL" value={riskStepUpExample} />
      </section>

      <section id="webhooks" className="docs-section">
        <p className="docs-kicker">WEBHOOKS</p><h2>Outbox durable, firma y replay operativo.</h2>
        <div className="webhook-contract-grid">
          <article><strong>Entrega</strong><p>POST HTTPS público, puerto 443, timeout de 4 segundos y éxito ante cualquier respuesta 2xx. Redirecciones no se siguen.</p></article>
          <article><strong>Firma</strong><p>HMAC-SHA256 sobre <code>timestamp.raw_body</code>. Ventana predeterminada del SDK: 5 minutos y comparación en tiempo constante.</p></article>
          <article><strong>Reintentos</strong><p>Hasta 7 intentos totales. Backoff después de cada fallo: 1m, 5m, 30m, 2h, 6h y 24h.</p></article>
          <article><strong>Operación</strong><p>Estados, status HTTP, error e historial de intentos quedan persistidos. Owner/Admin puede reencolar una entrega.</p></article>
        </div>
        <CodeBlock language="JSON · EVENTO REAL" value={webhookPayload} />
        <CodeBlock language="TYPESCRIPT · VERIFICACIÓN" value={webhookVerification} />
        <details className="event-catalog"><summary>{WEBHOOK_EVENT_TYPES.length} tipos de evento implementados <span>Ver catálogo</span></summary><div>{WEBHOOK_EVENT_TYPES.map((event) => <code key={event}>{event}</code>)}</div></details>
      </section>

      <section id="reference" className="docs-section docs-reference-section">
        <p className="docs-kicker">API REFERENCE</p><h2>Todo el contrato publicado.</h2>
        <p className="docs-section-lede">La lista siguiente se genera desde <code>public/openapi.yaml</code>; no existe un inventario paralelo escrito a mano. Cada operación muestra autenticación, scope, Content-Type, parámetros y respuestas declaradas.</p>
        <EndpointReference operations={reference.operations} />
      </section>

      <section id="changelog" className="docs-section">
        <p className="docs-kicker">CHANGELOG</p><h2>Cambios que ya están en el runtime.</h2>
        <div className="docs-changelog">{changelog.map((entry) => <article key={`${entry.date}-${entry.title}`}><time>{entry.date}</time><div><h3>{entry.title}</h3><p>{entry.detail}</p></div></article>)}</div>
        <div className="docs-note"><strong>Versionado actual</strong><p>La ruta mayor es <code>/api/v1</code> y cada respuesta publica <code>Cimbra-Version: {reference.version}</code> y <code>Cimbra-Environment</code>. Live no está habilitado; el flip de entorno reutiliza este contrato.</p></div>
      </section>
    </article>

    <aside className="docs-toc">
      <strong>EN ESTA PÁGINA</strong>
      <a href="#overview">Overview</a><a href="#environments">Entornos</a><a href="#quickstart">Quickstart</a><a href="#authentication">Autenticación</a><a href="#idempotency">Idempotencia</a><a href="#errors">Errores</a><a href="#sdk">SDK</a><a href="#book-transfers">Book transfers</a><a href="#wallets">Wallets</a><a href="#instant-payments">Pagos AR</a><a href="#collections">Cobranzas</a><a href="#payouts">Payouts</a><a href="#billers">Servicios</a><a href="#due-diligence">KYC/KYB</a><a href="#risk-step-up">Step-up</a><a href="#webhooks">Webhooks</a><a href="#reference">API reference</a><a href="#changelog">Changelog</a>
      <div><span>{user ? `Sesión activa · ${user.displayName.split(' ')[0]}` : '¿Necesitás credenciales?'}</span><Link href={user ? '/console' : '/login?return_to=%2Fconsole'}>{user ? 'Abrir Developers' : 'Ingresar'} →</Link></div>
    </aside>
  </main>;
}
