# Plataforma financiera propia

## Decisión de producto

Cimbra construye y comercializa su propio core financiero, capa de pagos, issuing y processing, acquiring, bill payments, lending, riesgo, conciliación, tesorería y developer platform. BIND/bindX, Dock, tapi, Pismo, Pomelo y Wibond son benchmarks de cobertura y experiencia; no son dependencias, adaptadores configurables ni rutas comerciales del producto.

La independencia tecnológica no elimina la realidad de los rieles. Para mover fondos, emitir o adquirir en producción hay que conectarse directamente con bancos, cámaras compensadoras, esquemas de tarjetas, redes de pago, fuentes oficiales y autoridades, o utilizar un sponsor regulado cuando la ley no permita membresía directa. Esas conexiones son infraestructura regulada, no outsourcing del producto a un competidor.

## Superficie competitiva Cimbra

| Dominio propio | Superficie objetivo | Interfaces | Estado actual |
| --- | --- | --- | --- |
| Identity & Tenancy | organizaciones, invitaciones verificadas, RBAC, API keys, MFA, maker/checker, auditoría | API, webhooks, consola | Sandbox operativo |
| Customers, KYC & KYB | personas/empresas, evidencia, screening, casos | API, webhooks, SDK, consola | Base técnica |
| Financial Core | cuentas, ledger, holds, límites, fees, reversas | API, webhooks, SDK, consola | Sandbox operativo |
| Payment Orchestration | intents, cash-in/out, transfers, routing, estados | API, webhooks, SDK, consola | Sandbox operativo |
| Instant Payments | transferencias, alias, QR, request-to-pay, returns | API, webhooks, archivos | Roadmap |
| Card Issuing | programas, lifecycle, controles, tokenización | API, webhooks, SDK, consola | Base técnica |
| Card Processing | autorización, stand-in, clearing, disputes, 3DS | API, ISO 8583, eventos, archivos | Roadmap |
| Acquiring | checkout, links, QR, POS, Tap to Phone, split | API, webhooks, SDK, ISO 8583 | Roadmap |
| Bill Payments | catálogo, deuda, pago, recargas, suscripciones | API, webhooks, SDK, archivos | Roadmap |
| Wallets | white-label, balances, pockets y payouts | API, webhooks, SDK, consola | Base técnica |
| Lending | originación, líneas, schedules, intereses y cobranza | API, webhooks, SDK, consola | Roadmap |
| Risk & Fraud | reglas, velocity, scoring, casos y decisiones | API, webhooks, SDK, consola | Sandbox operativo |
| Reconciliation & Settlement | ingestión API/CSV, matches, excepciones, ciclos programables y doble aprobación | API, webhooks, SDK, archivos, consola | Sandbox operativo |
| Treasury | posición, prefunding, forecasting y sweeps | API, webhooks, archivos, consola | Roadmap |
| Developer Platform | API v1, SDK, sandbox, webhooks y observabilidad | API, SDK, consola | Sandbox operativo |

La fuente ejecutable de este catálogo es `GET /api/v1/capabilities`. `delivery=cimbra_native` y `competitorDependency=false` son invariantes del contrato. Los estados evitan vender como terminado lo que todavía no fue construido o certificado.

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

1. cerrar financial core, payments, developer platform, reconciliación y controles de riesgo;
2. obtener design partners y elegir un solo país/riel inicial;
3. construir el conector directo, operación y certificación de ese riel;
4. completar issuing/processing o acquiring según demanda contractual;
5. expandir bill payments, lending y tesorería sin degradar confiabilidad ni margen.

Esto conserva la ambición competitiva y evita financiar seis compañías incompletas a la vez.

## Benchmark permanente

La comparación se mantiene por capacidad, no por conexión: breadth funcional, tiempo a primer request, cobertura de lifecycle, webhooks, consistencia, observabilidad, conciliación, uptime, certificaciones, experiencia operativa y costo total. Una capacidad sólo pasa de `roadmap` a `foundation` con diseño y base técnica; pasa a `sandbox` con contrato API ejecutable y pruebas; y se declara productiva únicamente tras controles, certificación y evidencia operativa.
