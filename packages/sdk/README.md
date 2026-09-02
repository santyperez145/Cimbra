# Cimbra SDK para TypeScript

Cliente oficial y tipado para la API v1 de Cimbra. Requiere Node.js 20 o superior.

La versión `0.1.0` se distribuye hoy como artefacto verificable desde el sandbox. Todavía no está publicada en el registry público de npm.

```bash
npm install https://cimbra-rose.vercel.app/sdk/cimbra-sdk-0.1.0.tgz
```

El checksum SHA-256 se publica junto al paquete en
`https://cimbra-rose.vercel.app/sdk/cimbra-sdk-0.1.0.sha256`.

```ts
import { Cimbra } from '@cimbra/sdk';

const cimbra = new Cimbra({ apiKey: process.env.CIMBRA_API_KEY! });
const result = await cimbra.customers.create({
  type: 'business',
  name: 'Comercio del Sur',
  country: 'AR',
  taxId: '30712345678',
});

console.log(result.data.customer.id, result.requestId);
```

Las colecciones exponen paginación por cursor estable:

```ts
const page = await cimbra.customers.list({ limit: 25 });
const next = page.data.nextCursor
  ? await cimbra.customers.list({ limit: 25, cursor: page.data.nextCursor })
  : null;
```

Para recorrer toda una colección sin administrar cursores manualmente, el SDK ofrece un iterador asíncrono con carga bajo demanda:

```ts
for await (const customer of cimbra.customers.listAll({ limit: 100 })) {
  console.log(customer.id);
}
```

La API responde `Idempotent-Replayed: true` al devolver una mutación previa y `Cimbra-Should-Retry` cuando puede determinar si un error admite reintento. El SDK respeta esa señal antes de aplicar backoff exponencial.

Cada recurso puede recuperarse directamente por su identificador:

```ts
const customer = await cimbra.customers.retrieve('00000000-0000-4000-8000-000000000001');
```

## Orquestación KYC/KYB

El tipo de customer define el expediente y su política requerida. Una integración S2S puede preparar evidencia, partes y checks, y enviarlo a revisión:

```ts
const opened = await cimbra.dueDiligence.create({ customerId: customer.data.id, expiresInDays: 90 });
const caseId = opened.data.case.id;

await cimbra.dueDiligence.addParty(caseId, {
  role: 'beneficial_owner', name: 'Ana Sur', taxId: '20123456789', ownershipPercentage: 25,
});
await cimbra.dueDiligence.recordCheck(caseId, {
  checkType: 'sanctions', source: 'official_registry', status: 'passed',
  resultCode: 'no_match', note: 'Consulta directa documentada.',
});
await cimbra.dueDiligence.submit(caseId);
```

El SDK no expone una decisión automática: aprobar o rechazar exige una sesión humana, otro Owner/Admin con MFA y separación maker/checker. El sandbox registra evidencia y lifecycle, pero no afirma biometría, consultas oficiales ni aprobación regulatoria si no existe una fuente directa certificada.

## Programas y controles de tarjetas

```ts
const program = await cimbra.cardPrograms.create({
  name: 'Débito regional ARS',
  product: 'debit',
  formats: ['virtual', 'physical'],
  defaultCurrency: 'ARS',
});

const issued = await cimbra.cards.create({
  programId: program.data.program.id,
  accountId: '00000000-0000-4000-8000-000000000001',
  format: 'physical',
});

await cimbra.cards.transition(issued.data.card.id, { status: 'active', reason: 'activation' });
await cimbra.cards.updateControls(issued.data.card.id, {
  currency: 'ARS',
  perTransactionLimit: '250000.00',
  dailyLimit: '500000.00',
  monthlyLimit: '3000000.00',
  allowedChannels: ['ecommerce', 'contactless', 'chip'],
  allowedMccs: [],
  blockedMccs: ['7995'],
  status: 'active',
});
```

Los cambios de estado validan una máquina de transiciones explícita; `terminated` es terminal. Cada ajuste de controles crea una versión inmutable y emite eventos. Este contrato es un sandbox propio de Cimbra: nunca devuelve PAN/CVV ni implica emisión o autorización en redes reales.

## Cash-in y cash-out

```ts
await cimbra.payments.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  direction: 'cash_in',
  counterparty: 'Banco patrocinador',
  description: 'Ingreso conciliado',
  amount: '250000.00',
  currency: 'ARS',
});
```

## Catálogo de servicios Cimbra

```ts
const catalog = await cimbra.capabilities.list();
const available = catalog.data.data.filter((service) => service.availability === 'sandbox' || service.availability === 'live');
```

El catálogo declara qué dominios son nativos de Cimbra, sus interfaces (`rest_api`, `webhooks`, `sdk`, `console`, `iso8583`, archivos o streaming), el grado real de disponibilidad y su límite regulatorio. No registra ni requiere conexiones con plataformas competidoras.

## Servicios, recargas y pagos recurrentes

El originador directo registra un biller y emite sus obligaciones dentro del tenant. La referencia completa del suscriptor se usa como input protegido y nunca vuelve en una respuesta:

```ts
const biller = await cimbra.billers.create({
  code: 'ENERGIA_AR', name: 'Energía Regional', country: 'AR', category: 'utilities',
  serviceType: 'bill_payment', currency: 'ARS', amountMode: 'exact',
  contractReference: 'DIRECT-2026-001',
});
const debt = await cimbra.billers.createObligation(biller.data.biller.id, {
  externalReference: 'INV-2026-0001', subscriberReference: 'CLIENTE-00123456',
  amount: '18250.00', dueAt: '2026-09-10T21:00:00.000Z', description: 'Servicio agosto 2026',
});
const paid = await cimbra.billPayments.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  billerId: biller.data.biller.id,
  obligationId: debt.data.obligation.id,
});
```

Para recargas o gift cards, el biller define rango o monto fijo y la orden recibe `destinationReference` y `amount`. Los mandatos semanales o mensuales conservan consentimiento, límite y política de reintentos:

```ts
const mandate = await cimbra.recurringMandates.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  billerId: biller.data.biller.id,
  subscriberReference: 'CLIENTE-00123456',
  frequency: 'monthly',
  amountLimit: '25000.00',
  consentReference: 'CONSENT-2026-001',
  consentedAt: new Date().toISOString(),
  nextChargeAt: '2026-09-10T12:00:00.000Z',
});
await cimbra.recurringMandates.pause(mandate.data.mandate.id);
```

Estas órdenes reutilizan cuentas, ledger de doble partida, riesgo, holds, auditoría y webhooks; una reversa crea postings compensatorios. El sandbox no inventa consultas de deuda ni cobertura comercial y no debita dinero real: cada país requiere contratos directos, consentimiento exigible y homologación del riel.

## Book transfers y estados de cuenta

```ts
const transfer = await cimbra.bookTransfers.create({
  externalReference: 'BT-2026-0001',
  sourceAccountId: '00000000-0000-4000-8000-000000000001',
  destinationAccountId: '00000000-0000-4000-8000-000000000002',
  description: 'Distribución de saldo marketplace',
  amount: '1250.00',
  currency: 'ARS',
});

if (!transfer.data.requiresApproval) {
  const statement = await cimbra.accounts.statement(transfer.data.transfer.sourceAccountId, {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
    limit: 50,
  });
  console.log(statement.data.period.openingBalance, statement.data.period.closingBalance);
}
```

El book transfer debita origen y acredita destino dentro de un solo journal, exige cuentas activas del mismo tenant/moneda, descuenta holds del saldo disponible y comparte riesgo y `transfer.create` maker/checker. Una reversa mediante `cimbra.bookTransfers.reverse(id)` agrega postings compensatorios. El statement pagina postings inmutables y calcula apertura/cierre para un período máximo de 366 días. Es un rail interno del sandbox: no representa CBU/CVU, Pix, SPEI ni custodia de dinero real.

## Wallets y bolsillos

```ts
const program = await cimbra.walletPrograms.create({
  name: 'Wallet marketplace ARS',
  displayName: 'Billetera Comercio Sur',
  defaultCurrency: 'ARS',
  pocketKinds: ['available', 'pending'],
});

const wallet = await cimbra.wallets.create({
  programId: program.data.program.id,
  customerId: '00000000-0000-4000-8000-000000000010',
  externalReference: 'WALLET-001',
});

await cimbra.wallets.transfer(wallet.data.wallet.id, {
  externalReference: 'WP-001',
  sourcePocketId: wallet.data.pockets[0].id,
  destinationPocketId: wallet.data.pockets[1].id,
  description: 'Reserva operativa',
  amount: '25.00',
  currency: 'ARS',
});
```

Cada bolsillo es una cuenta de producto. Freeze y close inactivan esas cuentas; cerrar exige saldo cero y sin holds. El sandbox no custodia fondos ni publica una app de consumidor.

## Pagos instantáneos sandbox (Argentina)

```ts
const issued = await cimbra.railInstruments.issue({
  accountId: '00000000-0000-4000-8000-000000000001',
});
await cimbra.railInstruments.assignAlias(issued.data.instruments[0].id, {
  alias: 'COMERCIO.SUR',
});
await cimbra.instantTransfers.create({
  externalReference: 'IP-001',
  accountId: '00000000-0000-4000-8000-000000000002',
  destination: issued.data.instruments[0].value,
  description: 'Cobro inmediato',
  amount: '1500.00',
  currency: 'ARS',
  confirmHolder: true,
  holderName: preview.data.holderName!,
  taxIdLast4: preview.data.taxIdLast4!,
});
await cimbra.railInstruments.revoke(issued.data.instruments[0].id);
```

El CVU usa prefijo `000` y código PSP `9999` de Cimbra, no un código Coelsa. El alias vive en el tenant: se asigna o cambia sobre un CVU existente, con un cambio real cada 24 horas. Eliminar el CVU no borra la cuenta ni el saldo. Un débito externo no está soportado. El QR dinámico `cimbra:qr:v1` se consume en un pago; el estático `cimbra:qr:static:v1` es reutilizable hasta cancelarlo. Una orden de venta Cimbra fija un monto cerrado sobre ese QR estático. Un QR de deuda `cimbra:qr:debt:v1` es un recurso primario con monto cerrado y un solo pago.

```ts
const staticQr = await cimbra.paymentQrs.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  description: 'Mostrador',
  kind: 'static',
});
await cimbra.paymentQrs.pay(staticQr.data.qr.id, {
  sourceAccountId: '00000000-0000-4000-8000-000000000002',
  externalReference: 'QR-001',
  amount: '1500.00',
});
const saleOrder = await cimbra.qrSaleOrders.create({
  paymentQrId: staticQr.data.qr.id,
  externalReference: 'OV-001',
  description: 'Ticket mostrador',
  amount: '2500.00',
});
await cimbra.qrSaleOrders.cancel(saleOrder.data.order.id);
const debt = await cimbra.qrDebts.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  externalReference: 'DEUDA-001',
  description: 'Cuota única',
  amount: '3200.00',
});
await cimbra.paymentQrs.pay(debt.data.debt.paymentQrId, {
  sourceAccountId: '00000000-0000-4000-8000-000000000002',
  externalReference: 'QR-DEBT-001',
});
await cimbra.paymentQrs.cancel(staticQr.data.qr.id);
```

## Cobranzas sandbox (Argentina)

```ts
const link = await cimbra.paymentLinks.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  externalReference: 'FAC-001',
  description: 'Honorarios agosto',
  amount: '18500.00',
  currency: 'ARS',
  methods: ['cimbra_qr'],
  qrDebtId: '00000000-0000-4000-8000-000000000099',
});
await cimbra.paymentLinks.pay(link.data.link.id, {
  method: 'cimbra_qr',
  payerAccountId: '00000000-0000-4000-8000-000000000002',
});
```

El payload `cimbra:link:v1` no es un checkout de red. `cimbra_qr` liquida la deuda asociada al monto cerrado. `cimbra_cvu` acredita el till y admite parciales, varios créditos o un importe mayor al restante; `checkoutUrl` apunta a `/pay/{id}` sin formulario PCI. Tarjeta, POS, checkout de adquirente y QR interoperable responden `422`.

```ts
await cimbra.paymentLinks.pay(cvuLink.data.link.id, {
  method: 'cimbra_cvu',
  amount: '3.00',
});
```

```ts
const till = await cimbra.collectionTills.create({
  accountId: '00000000-0000-4000-8000-000000000001',
  externalReference: 'TILL-001',
  name: 'Mostrador Sur',
});
await cimbra.collectionTills.inbound(till.data.till.id, {
  externalReference: 'INB-001',
  description: 'Transferencia recibida',
  amount: '1500.00',
});
```

El CVU del till es sandbox (`000`+`9999`) y no viaja por Coelsa. No es una caja BIND.

## ECHEQ sandbox (Argentina)

```ts
const issued = await cimbra.echeqs.issue({
  drawerAccountId: '00000000-0000-4000-8000-000000000001',
  externalReference: 'CHQ-001',
  description: 'Alquiler septiembre',
  amount: '18500.00',
  beneficiaryName: 'Comercio Sur',
  beneficiaryTaxId: '30000075678',
});
await cimbra.echeqs.accept(issued.data.echeq.id, {
  accountId: '00000000-0000-4000-8000-000000000002',
  taxId: '30000075678',
});
await cimbra.echeqs.deposit(issued.data.echeq.id, {
  accountId: '00000000-0000-4000-8000-000000000002',
  taxId: '30000075678',
});
```

El payload `cimbra:echeq:v1` no es un CMC7 ni un ID Coelsa. Descuento, custodia, USD y depósito en CBU/CVU responden `422`. La acreditación sandbox es inmediata sobre el ledger.

## Beneficiarios y payouts masivos

```ts
const beneficiary = await cimbra.payoutBeneficiaries.create({
  externalReference: 'PROVIDER-001', name: 'Proveedor Regional', entityType: 'business',
  country: 'AR', currency: 'ARS', destinationType: 'alias', destination: 'proveedor.cimbra',
});
const batch = await cimbra.payoutBatches.create({
  sourceAccountId: '00000000-0000-4000-8000-000000000001', externalReference: 'PAYROLL-2026-09-01',
  description: 'Liquidación de proveedores', currency: 'ARS',
  items: [{ externalReference: 'ITEM-001', beneficiaryId: beneficiary.data.beneficiary.id, amount: '125000.00', description: 'Liquidación agosto' }],
});
await cimbra.payoutBatches.submit(batch.data.batch.id);
const result = await cimbra.payoutBatches.resultCsv(batch.data.batch.id);
```

El destino completo se transforma en un digest tenant-scoped y nunca vuelve en respuestas o archivos. El envío devuelve `202`, se ejecuta por ítem con lease, riesgo y ledger, y puede exigir doble aprobación. El CSV contiene resultados reales del sandbox. Para mover dinero real se requiere un riel bancario o cámara conectado directamente y homologado.

## Riesgo y fraude

```ts
await cimbra.risk.createRule({
  name: 'Cash-out alto USD',
  kind: 'amount_threshold',
  operationType: 'cash_out',
  scoreDelta: 60,
  action: 'review',
  configuration: { threshold: '30000.00', currency: 'USD' },
});

const risk = await cimbra.risk.state();
```

Una nueva versión se prueba fuera del camino de decisión y sólo se activa con una promoción explícita:

```ts
const challenger = await cimbra.risk.createRuleVersion(risk.data.data.rules[0].id, {
  name: 'Cash-out alto USD', kind: 'amount_threshold', operationType: 'cash_out',
  scoreDelta: 70, action: 'review', configuration: { threshold: '25000.00', currency: 'USD' },
});
await cimbra.risk.simulate({
  candidateRuleId: challenger.data.rule.id,
  samples: [{ operationType: 'cash_out', amount: '27500.00', currency: 'USD', counterparty: 'Comercio de prueba' }],
});
await cimbra.risk.promoteRule(challenger.data.rule.id);
```

Las integraciones pueden enviar referencias sensibles como input; Cimbra sólo devuelve presencia y señales derivadas:

```ts
const evaluation = await cimbra.risk.evaluate({
  operationType: 'transfer', amount: '1250.00', currency: 'ARS', counterparty: 'Proveedor Sur',
  signals: { deviceReference: 'device-internal-42', identityReference: 'customer-internal-9', deviceTrust: 'unknown' },
});
const entry = await cimbra.risk.createListEntry({
  subjectType: 'device', subjectValue: 'device-internal-42', category: 'watch', reason: 'Revisión interna',
});
await cimbra.risk.reportOutcome(evaluation.data.evaluation.id, {
  label: 'fraud', fraudType: 'account_takeover', lossAmount: '1250.00', currency: 'ARS',
});
await cimbra.risk.disableListEntry(entry.data.entry.id);
```

Una evaluación en `review` puede exigir un step-up OTP nativo:

```ts
const challenge = await cimbra.risk.createStepUpChallenge(evaluation.data.evaluation.id, {
  expiresInSeconds: 300,
  maxAttempts: 5,
});
// Entregar desde backend por un canal aprobado por tu organización.
const verified = await cimbra.risk.verifyStepUpChallenge(
  evaluation.data.evaluation.id,
  challenge.data.challenge.id,
  { credential: challenge.data.credential! },
);
```

La credencial aparece sólo en el create y su replay idéntico mientras permanece pendiente; no se devuelve en `listStepUpChallenges`, eventos o auditoría. Los intentos son append-only y el lifecycle no resuelve automáticamente el caso ni evita maker/checker. Esto es autenticación reforzada rail-agnostic del sandbox, no EMV 3DS ni un ACS certificado.

Las transferencias y los cash-out ejecutan sólo las champions activas dentro de su flujo transaccional. Las referencias de dispositivo e identidad se hashean con aislamiento por tenant antes de persistirse. Las muestras de simulación no se guardan: Cimbra persiste únicamente agregados. Una decisión `review` crea evaluación, caso y hold vinculados; los outcomes confirmados alimentan precisión, recall, tasa de falsos positivos y pérdida por moneda sin reemplazar historial. El estado de riesgo agrega latencia p50/p95/p99 y cumplimiento del objetivo de 250 ms únicamente sobre evaluaciones nuevas con medición persistida.

## Conciliación

```ts
await cimbra.reconciliation.createRun({
  name: 'Cierre bancario diario',
  source: 'bank',
  currency: 'ARS',
  periodStart: '2026-08-27T00:00:00.000Z',
  periodEnd: '2026-08-28T00:00:00.000Z',
  entries: [{
    externalReference: 'BANK-0001',
    transactionId: '00000000-0000-4000-8000-000000000001',
    direction: 'credit',
    amount: '1250.00',
  }],
});
```

Cada corrida conserva partidas exactas, totales, faltantes en ambos lados y diferencias. Las excepciones se resuelven con nota, actor, timestamp e idempotencia.

## Disputas y chargebacks

```ts
const opened = await cimbra.disputes.create({
  transactionId: '00000000-0000-4000-8000-000000000001',
  reason: 'service_not_received',
  description: 'El servicio no fue entregado y existe evidencia privada.',
  amount: '1250.00',
  currency: 'ARS',
  provisionalCreditRequested: true,
});

await cimbra.disputes.transition(opened.data.dispute.id, {
  event: 'start_review',
  note: 'Evidencia inicial validada por Operaciones.',
});
```

El crédito provisional y su eventual compensación se contabilizan como transacciones y journals nuevos: nunca se alteran postings históricos. `network_ready` significa que el expediente está preparado, no que Cimbra lo haya presentado a una red real. Esa conexión exige sponsor y certificación directos.

## Cola operativa

Los casos de riesgo, las excepciones de conciliación y las disputas comparten una cola operativa sin perder sus modelos de dominio:

```ts
const queue = await cimbra.operations.list();
const item = queue.data.data.workItems.find((candidate) => candidate.status === 'open');

if (item) {
  await cimbra.operations.update(item.type, item.id, {
    assignedToUserId: queue.data.data.members[0]?.userId ?? null,
    priority: 'high',
    dueAt: '2026-08-30T12:00:00.000Z',
  });
  await cimbra.operations.addNote(item.type, item.id, 'Evidencia revisada por Operaciones.');
}
```

La asignación valida membresía en el tenant. Los SLA, comentarios y vínculos a documentos privados quedan persistidos, auditados y publicados mediante webhooks. Las mutaciones son idempotentes.

También podés importar el contrato CSV canónico sin construir el array manualmente:

```ts
const imported = await cimbra.reconciliation.importCsv({
  name: 'Extracto banco diario',
  source: 'bank',
  currency: 'ARS',
  periodStart: '2026-08-27T00:00:00.000Z',
  periodEnd: '2026-08-28T00:00:00.000Z',
  fileName: 'bank-2026-08-28.csv',
  csv: 'external_reference,transaction_id,direction,amount\nBANK-1,,credit,1250.00',
});
```

El SDK envía `multipart/form-data`; Cimbra descarta el archivo crudo después de validarlo y conserva el checksum SHA-256, el nombre seguro y las partidas normalizadas.

## Settlement sandbox

```ts
const created = await cimbra.settlements.create({
  reconciliationRunId: imported.data.run.id,
  name: 'Liquidación banco diaria',
  scheduledFor: '2026-08-29T03:00:00.000Z',
});

const execution = await cimbra.settlements.execute(created.data.cycle.id);
if ('approval' in execution.data) {
  console.log('Pendiente de doble aprobación:', execution.data.approval.id);
}
```

Sólo una conciliación `completed` puede generar un ciclo y cada corrida admite uno. El ciclo registra el neto, diferencia, programación, ejecución, auditoría y webhooks; en sandbox no ordena ni mueve fondos reales. Si el tenant activa maker/checker, `execute` devuelve una solicitud pendiente y la ejecución sólo ocurre cuando otro owner/admin con MFA la aprueba desde una sesión humana. Las integraciones pueden consultar el estado con `cimbra.approvals.list()` o `retrieve()`; el SDK no permite que una API key actúe como checker.

Las escrituras financieras seguras generan automáticamente una clave de idempotencia y conservan el mismo `X-Request-Id` durante los reintentos. También se puede proporcionar una clave propia:

```ts
const transfer = await cimbra.transfers.create(
  { counterparty: 'Proveedor', description: 'Liquidación', amount: '1250.50', currency: 'ARS' },
  { idempotencyKey: 'liquidacion-2026-08-28-001' },
);

if (transfer.data.requiresApproval) {
  console.log('Transferencia pendiente de checker:', transfer.data.approval.id);
}
```

Si la política `transfer.create` está activa, la llamada no crea aún un movimiento: devuelve `202` y una solicitud. Otro owner/admin con MFA debe aprobar desde una sesión humana; recién entonces Cimbra vuelve a validar saldo y riesgo y crea la transferencia, el hold o el ledger correspondiente dentro de la misma transacción. Un pending no reserva fondos, por lo que una aprobación puede finalizar como `failed` si el saldo o riesgo cambian. Los montos enviados se representan como strings decimales y los montos contables de respuesta incluyen su valor en unidades menores como string. Esto evita errores de punto flotante.

El mismo contrato protege decisiones operativas cuando el tenant activa `risk.case.resolve` o `reconciliation.exception.resolve`:

```ts
const decision = await cimbra.risk.resolveCase(caseId, {
  resolution: 'approved',
  note: 'Evidencia y contraparte verificadas.',
});

if (decision.data.requiresApproval) {
  console.log('Caso pendiente de checker:', decision.data.approval.id);
}
```

El caso o la excepción permanecen abiertos hasta la decisión independiente. La aprobación vuelve a validar el estado y ejecuta la resolución, el hold asociado y la auditoría en la misma transacción. Las API keys pueden originar el pedido con su scope de escritura, pero nunca actuar como checker.

## Verificar webhooks

```ts
import { constructWebhookEvent } from '@cimbra/sdk';

const event = await constructWebhookEvent({
  payload: rawRequestBody,
  signature: request.headers.get('cimbra-signature')!,
  timestamp: request.headers.get('cimbra-timestamp'),
  secret: process.env.CIMBRA_WEBHOOK_SECRET!,
});
```

La verificación usa HMAC-SHA256, comparación de tiempo constante y una tolerancia predeterminada de cinco minutos. Debe verificarse el cuerpo crudo antes de deserializarlo.
