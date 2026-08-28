# Cimbra SDK para TypeScript

Cliente oficial y tipado para la API v1 de Cimbra. Requiere Node.js 20 o superior.

```bash
npm install @cimbra/sdk
```

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

Las escrituras financieras seguras generan automáticamente una clave de idempotencia y conservan el mismo `X-Request-Id` durante los reintentos. También se puede proporcionar una clave propia:

```ts
await cimbra.transfers.create(
  { counterparty: 'Proveedor', description: 'Liquidación', amount: '1250.50', currency: 'ARS' },
  { idempotencyKey: 'liquidacion-2026-08-28-001' },
);
```

Los montos enviados se representan como strings decimales y los montos contables de respuesta incluyen su valor en unidades menores como string. Esto evita errores de punto flotante.

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
