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
const available = catalog.data.data.filter((service) => service.availability === 'sandbox');
```

El catálogo declara qué dominios son nativos de Cimbra, sus interfaces (`rest_api`, `webhooks`, `sdk`, `console`, `iso8583`, archivos o streaming), el grado real de disponibilidad y su límite regulatorio. No registra ni requiere conexiones con plataformas competidoras.

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

Las transferencias y los cash-out ejecutan sólo las champions activas dentro de su flujo transaccional. Las muestras de simulación no se guardan: Cimbra persiste únicamente agregados. Una decisión `review` crea evaluación, caso y hold vinculados; resolver el caso captura o libera la reserva de manera idempotente.

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

## Cola operativa

Los casos de riesgo y las excepciones de conciliación comparten una cola operativa sin perder sus modelos de dominio:

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
