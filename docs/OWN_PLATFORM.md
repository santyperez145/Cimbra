# Plataforma financiera propia

## Decisión de producto

Cimbra construye y comercializa su propio core financiero, capa de pagos, issuing y processing, acquiring, bill payments, lending, riesgo, conciliación, tesorería y developer platform. BIND/bindX, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks de cobertura y experiencia; no son dependencias, adaptadores configurables ni rutas comerciales del producto.

La independencia tecnológica no elimina la realidad de los rieles. Para mover fondos, emitir o adquirir en producción hay que conectarse directamente con bancos, cámaras compensadoras, esquemas de tarjetas, redes de pago, fuentes oficiales y autoridades, o utilizar un sponsor regulado cuando la ley no permita membresía directa. Esas conexiones son infraestructura regulada, no outsourcing del producto a un competidor.

## Superficie competitiva Cimbra

| Dominio propio | Superficie objetivo | Interfaces | Estado actual |
| --- | --- | --- | --- |
| Identity & Tenancy | organizaciones, invitaciones verificadas, RBAC, API keys, MFA, maker/checker, auditoría | API, webhooks, consola | Sandbox operativo |
| Customers, KYC & KYB | personas/empresas, partes relacionadas, evidencia, checks, casos, vencimiento y decisión maker/checker | API, webhooks, SDK, consola | Sandbox operativo; sin verificación externa certificada |
| Financial Core | cuentas, ledger, book transfers, statements, wallets, pockets, holds, límites, fees, reversas | API, webhooks, SDK, consola | Sandbox operativo |
| Payment Orchestration | intents, cash-in/out, transfers, routing, estados y doble aprobación | API, webhooks, SDK, consola | Sandbox operativo |
| Beneficiaries & Payout Batches | destinos protegidos, lotes inmutables, agenda/deadline, doble aprobación, ejecución y resultado por ítem | API, webhooks, SDK, archivos, consola | Sandbox operativo; sin riel de dinero real |
| Instant Payments | CVU sandbox, alias tenant, asignar/cambiar alias, confirmación de titular, crédito, débito interno, QR Cimbra, returns | API, webhooks, SDK, consola | Sandbox operativo; sin Coelsa, DEBIN, directorio nacional ni QR interoperable |
| ECHEQ | emisión, aceptación, endoso, depósito interno, NSF, anulación y devolución previa | API, webhooks, SDK, consola | Sandbox operativo; sin Coelsa, CMC7, descuento, custodia ni compensación de cámara |
| Card Issuing | programas, lifecycle, límites y controles por canal/MCC; tokenización futura | API, webhooks, SDK, consola | Sandbox operativo sin PAN/CVV ni red |
| Disputes & Chargebacks | disputas parciales, lifecycle, evidencia, créditos compensables, SLA | API, SDK, eventos, consola | Sandbox |
| Card Processing | autorización, stand-in, clearing, presentments, 3DS | API, ISO 8583, eventos, archivos | Roadmap |
| Acquiring & Collections | links de cobro, eco cerrado, inbound sandbox, refunds; POS/tarjetas/QR interoperable futuro | API, webhooks, SDK, consola | Sandbox operativo; sin tarjetas, POS, Tap to Phone ni QR interoperable |
| Bill Payments & Top-ups | catálogo tenant, deuda emitida, pago, recargas, gift cards, reversas y mandatos recurrentes | API, webhooks, SDK, consola | Sandbox operativo; sin cobertura, biller externo ni débito homologado |
| Wallets | white-label, balances, pockets y configuración de programa | API, webhooks, SDK, consola | Sandbox operativo; sin custodia ni app de consumidor |
| Lending | originación, líneas, schedules, intereses y cobranza | API, webhooks, SDK, consola | Roadmap |
| Risk & Fraud | reglas, velocity, señales protegidas, listas tenant, scoring, step-up OTP, SLO p50/p95/p99, casos, outcomes confirmados, métricas supervisadas, ownership, SLA, evidencia y decisiones con doble aprobación | API, webhooks, SDK, consola | Sandbox operativo; no 3DS/ACS |
| Reconciliation & Settlement | ingestión API/CSV, matches, work queue, SLA, evidencia, ciclos programables y doble aprobación de settlement/excepciones | API, webhooks, SDK, archivos, consola | Sandbox operativo |
| Treasury | posición, prefunding, forecasting y sweeps | API, webhooks, archivos, consola | Roadmap |
| Developer Platform | API v1, SDK, sandbox, webhooks y observabilidad | API, SDK, consola | Sandbox operativo |

La fuente ejecutable de este catálogo es `GET /api/v1/capabilities`. El estado frente a dinero real es `GET /api/v1/live-readiness`: entornos sandbox/production documentados por Pismo, BIND y Pomelo; etapas Integración → Homologación → Go Live de Pomelo; y productos del catálogo público de BIND APIBANK, BIND PSP, Pomelo Issuing y tapi, cada uno homologable por separado. `delivery=cimbra_native` y `competitorDependency=false` son invariantes del contrato. Dock documenta Pix y tarjetas en Brasil; no se inventa un riel argentino a su nombre. Wibond no publica un contrato de riel usable.

## Arquitectura de provisión

Todos los dominios deben poder consumirse con recursos canónicos y versionados. REST cubre comandos y consultas; webhooks y streams distribuyen cambios; archivos cubren clearing y conciliación batch; ISO 8583 se limita al perímetro de tarjetas; la consola opera excepciones y el SDK reduce el trabajo de integración.

El modelo de despliegue evoluciona sin reescribir el contrato:

1. monolito modular en Next.js/PostgreSQL para validar producto y comportamiento;
2. servicios transaccionales en Go o Kotlin para core, authorization, payments y reconciliation;
3. outbox PostgreSQL ahora, event streaming y workflows durables cuando existan consumidores y volumen que lo justifiquen;
4. ECS/Fargate, RDS Multi-AZ, WAF, KMS, Secrets Manager y observabilidad como piloto reproducible;
5. HSM, PCI zone y conectividad privada agregados sólo a los dominios que procesen datos de tarjeta o rieles certificados.

El ledger permanece autoritativo y separado de conectores de red. Un fallo de banco, esquema o cámara nunca puede alterar asientos posteados: se resuelve con estados explícitos, reintentos idempotentes, conciliación y compensaciones.

## Secuencia de construcción

La amplitud es objetivo de plataforma, pero el capital se asigna por gates:

1. cerrar financial core, payments, payouts, developer platform, reconciliación y controles de riesgo;
2. obtener design partners y elegir un solo país/riel inicial;
3. construir el conector directo, operación y certificación de ese riel;
4. completar issuing/processing o acquiring según demanda contractual;
5. homologar la primera cobertura directa de bill payments y expandir instant payments, lending y tesorería sin degradar confiabilidad ni margen.

Esto conserva la ambición competitiva y evita financiar seis compañías incompletas a la vez.

## Benchmark permanente

La comparación se mantiene por capacidad, no por conexión: breadth funcional, tiempo a primer request, cobertura de lifecycle, webhooks, consistencia, observabilidad, conciliación, uptime, certificaciones, experiencia operativa y costo total. Una capacidad sólo pasa de `roadmap` a `foundation` con diseño y base técnica; pasa a `sandbox` con contrato API ejecutable y pruebas; y se declara `live` únicamente cuando ese producto concreto completó homologación y Go Live sobre un hostname de producción provisionado. Pedir `CIMBRA_OPERATING_MODE=live` sin hostname de producción no habilita dinero real.
