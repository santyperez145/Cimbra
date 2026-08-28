# Conectividad y benchmark de proveedores

Revisión: 28 de agosto de 2026. La matriz usa documentación pública oficial; capacidades, países, certificaciones y precios deben confirmarse contractualmente durante homologación.

## Patrón competitivo comprobado

| Plataforma | Fortaleza pública | Patrón técnico que Cimbra adopta | Decisión build/partner |
| --- | --- | --- | --- |
| BIND / bindX | APIs bancarias argentinas, cuentas, transferencias 7x24, cobranzas, onboarding y eCheq | OAuth/JWT por conexión, historial y detalle de operaciones, rate limits y homologación | Partner primario candidato en Argentina; Cimbra conserva API, ledger y portabilidad |
| Dock | Plataforma modular de banking, cards, acquiring y prevención de fraude en Latinoamérica | Módulos desacoplados, procesamiento a escala y conectividad enterprise | Partner de procesamiento; no recrear red/licencias en el MVP |
| tapi | Red regional para servicios, recargas y suscripciones con consulta, pago, confirmación y estado | Adaptador con workflow explícito y conciliación por operación | Partner para bill payments; Cimbra orquesta cuenta, riesgo y ledger |
| Pismo | Core cloud-native, más de 600 endpoints, eventos realtime/batch, cuentas, pagos, tarjetas y lending | API canónica extensa, control plane, arquitectura orientada a eventos y batch | Referencia de arquitectura; integración enterprise cuando el caso la justifique |
| Pomelo | Issuing/processing, balance authorizer, identidad, crédito, webhooks firmados y HSM para datos sensibles | Ciclo de vida por recurso, webhooks HMAC, tokenización y perímetro PCI mínimo | Partner preferido para issuing; PAN/CVV nunca entran al core Cimbra |
| Wibond | Wallet white-label, cuentas, payouts, liquidación, conciliación y crédito | Time-to-market white-label y operación unificada | Benchmark de empaque; partner o alternativa según mercado |

## Arquitectura adoptada

Cimbra expone recursos canónicos (`customers`, `accounts`, `payments`, `transfers`, `cards`) que no dependen del contrato de ningún proveedor. El control plane de conectividad se ofrece por API:

- `GET /api/v1/providers`: catálogo versionado de adaptadores, capacidades y transportes;
- `POST /api/v1/connections`: registra una conexión idempotente y aislada por tenant;
- `GET /api/v1/connections`: inventario paginado para operación y auditoría;
- `GET /api/v1/connections/{id}`: metadata segura, nunca secretos;
- SDK TypeScript con los mismos recursos;
- evento durable `connection.created` mediante webhooks firmados.

Las credenciales no se envían ni almacenan directamente. La API sólo acepta referencias `aws-secretsmanager://`, `gcp-secret-manager://`, `azure-key-vault://`, `vault://` o `env://`; Cimbra cifra esa referencia con AES-256-GCM y sólo devuelve `credentialConfigured: true`. Una conexión comienza en `pending_validation`: no se declara activa hasta completar credenciales, contrato, mTLS/VPN cuando corresponda y pruebas de homologación.

## Separación de planos

1. **Control plane:** tenants, conexiones, capacidades, políticas, rutas, health y auditoría.
2. **Data plane síncrono:** comandos canónicos, idempotencia, límites y respuestas normalizadas.
3. **Data plane asíncrono:** outbox, webhooks, callbacks del proveedor, reintentos y DLQ.
4. **Financial core:** ledger independiente, holds, fees, settlement y reversas compensatorias.
5. **Reconciliation plane:** archivos/API del proveedor, banco y ledger Cimbra; diferencias como casos operativos.

## Secuencia de entrega

1. Control plane y catálogo (implementado en este repositorio).
2. SPI de adaptadores y simulador contractual por proveedor.
3. Primer adaptador real BIND/bindX para transferencias y cuentas, sujeto a credenciales/contrato.
4. Segundo riel de contingencia y reglas de routing por país, moneda, costo, SLO y health.
5. Conciliación de tres vías, settlement y consola de excepciones.
6. Pomelo/Dock para issuing y tapi para servicios, sin ampliar PCI ni alcance regulatorio innecesariamente.

## Fuentes oficiales

- BIND PSP: https://psp.bind.com.ar/developers
- BIND / bindX: https://developers.bindx.com/transferencias-online-bind
- Dock: https://dock.tech/
- tapi: https://www.tapila.dev/api-reference
- Pismo: https://developers.pismo.io/pismo-docs/docs/welcome
- Pismo integrated payments: https://developers.pismo.io/pismo-docs/docs/integrated-payments
- Pomelo issuing: https://developers.pomelo.la/api-reference/cards/issuing
- Pomelo webhooks: https://developers.pomelo.la/api-reference/digital-accounts/webhooks
- Wibond wallet: https://www.wibond.co/servicio-wallet-eng
