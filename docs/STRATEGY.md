# Estrategia competitiva y negocio

## Tesis

La oportunidad es ofrecer una plataforma financiera regional propia que elimine la fragmentación entre core, pagos, emisión y procesamiento, acquiring, bill payments, lending, compliance y operación. Cimbra controla el producto, el modelo canónico, el ledger, la experiencia developer y la economía; los competidores se usan como benchmark, nunca como dependencia tecnológica.

## Lectura competitiva

### BIND / bindX

Fortaleza: banco, licencias, amplitud de APIs y llegada al ecosistema argentino. Cimbra debe igualar la cobertura de cuentas, transferencias, cobranzas y operación con un core regional propio; el acceso bancario se negocia directamente con entidades o cámaras habilitadas.

### Dock

Fortaleza: portafolio amplio de banking, cards, acquiring y fraude con operación a escala. Cimbra debe construir la misma amplitud modular, ganar en transparencia operativa y velocidad de integración y demostrar escala antes de convertir objetivos en SLA.

### tapi

Fortaleza: red regional de pagos de servicios y recargas, con foco y distribución. Cimbra construye su propio dominio de bill payments y obtiene cobertura mediante convenios directos con empresas y redes de origen, integrado a su ledger, riesgo y conciliación.

### Pismo

Fortaleza: core cloud-native, tarjetas, lending y clientes enterprise globales. Cimbra adopta el estándar de API extensa, eventos y batch, pero compite desde un core propio enfocado en Latinoamérica y una secuencia comercial disciplinada.

### Pomelo

Fortaleza: emisión y procesamiento de tarjetas, experiencia de integración y cobertura en América. Cimbra construye issuing, authorization y processing propios por etapas, con perímetro PCI/HSM separado y conexión directa a sponsor o esquemas certificados.

### Wibond

Fortaleza: propuesta white-label rápida con wallet, pagos y crédito. Cimbra debe superarla en profundidad developer, auditabilidad, configuración, controles enterprise y amplitud operativa sin perder time-to-market.

## Benchmark aplicado — riesgo y conciliación (29/08/2026)

El bloque sandbox actual iguala el patrón mínimo esperable de una infraestructura API-first: decisiones previas al posting, idempotencia por tenant, políticas inmutables por versión, lifecycle champion/challenger, simulación shadow con agregados, velocity, señales protegidas de dispositivo/identidad, listas tenant, score y razones persistidas, casos, outcomes confirmados, métricas supervisadas, resolución transaccional con holds, webhooks, SDK y una cola de excepciones de conciliación que detecta diferencias y faltantes en ambos sentidos.

La comparación oficial muestra, sin embargo, una brecha deliberadamente visible frente a productos maduros:

| Referencia | Patrón observado | Estado Cimbra | Decisión propia |
| --- | --- | --- | --- |
| BIND / bindX | OAuth2, rate limiting, cuentas y transferencias CBU/CVU 7x24 sobre riel bancario real | Contrato API, scopes, rate limit, ledger y transferencias sandbox | Conectar directamente el primer riel/sponsor; no usar bindX como dependencia |
| Dock | Antifraude transaccional en tiempo real, identidad, comportamiento, biometría, comunicación multicanal y operación 24x7 | Reglas determinísticas versionadas, shadow testing, velocity, señales protegidas, listas, casos, outcomes y auditabilidad | Agregar step-up, modelos offline evaluados y operación medida; no anunciar IA antes de tener volumen y evidencia |
| tapi | Una integración regional, sandbox, dashboard y soporte para bill payments, recargas y cash in/out | Developer platform uniforme, payments genéricos, consola y SDK; sin catálogo regional real | Construir billers y cash network mediante convenios directos por país |
| Pismo | Portal extenso, APIs, eventos real-time/batch, reglas de validación con resultados explícitos, metadata antifraude y reconciliación de clearing/DLQ | API v1, eventos firmados, decisión síncrona, señales protegidas, outcomes y conciliación por lote | Incorporar SLO de decisión, streaming/batch durable, replay operacional y reconciliación específica por riel |
| Pomelo | Idempotencia, autorización/ajustes, presentments asíncronos, bloqueos transaccionales, remedios de fraude, chargebacks y archivos diarios de conciliación | Idempotencia, listas block/watch/allow, holds/reversas, outcomes corregibles, casos y comparación de lotes vía API | Crear disputes/remedies específicos, ingestión firmada y presentments/clearing con máquina de estados |
| Wibond | Wallet/finanzas embebidas de implementación rápida; el detalle técnico público no permite validar paridad endpoint por endpoint | Core y developer platform propios con mayor trazabilidad visible | Validar producto, SLA, cobertura y precios directamente durante diligence |

Prioridad de producto resultante:

1. Evolucionar la ingestión CSV/checksum y el scheduling sandbox ya disponibles hacia intercambio firmado, cierre y settlement por riel directo.
2. Señales protegidas, listas tenant y outcomes confirmados ya están operativos; el siguiente control es un step-up propio, modelos offline evaluados contra esas etiquetas y SLO de decisión medido.
3. Asignación, SLA, escalamiento, evidencia, comentarios, maker/checker y versionado/simulación de políticas ya están operativos; el siguiente lifecycle es disputes/remedies específico por riel sin duplicar la cola de trabajo.
4. Publicar Postman, generación de SDKs adicionales, changelog y SLOs medidos; luego ejecutar homologación y certificaciones.

Ninguno de estos gaps autoriza conectar Cimbra con un competidor. Las únicas dependencias externas admisibles para operación real son bancos, cámaras, esquemas, redes, fuentes oficiales y sponsors regulados donde sean jurídicamente necesarios.

## Benchmark aplicado — identidad y operación por rol (28/08/2026)

Pismo documenta roles predefinidos por función, permission groups, acceso por organización, SSO y perfiles separados de operador, viewer, auditor y approver. Pomelo permite crear operadores, asignar roles y limitar pantallas y acciones, con alta por email y 2FA. Cimbra adopta ahora el núcleo propio necesario: invitaciones verificadas y vencibles, owner protegido, administración delegada sin escalamiento, operator mutante, viewer de lectura y eventos auditables. Owner/admin pueden actuar como checker bajo una política específica; roles personalizados, SSO empresarial y un perfil approver dedicado permanecen como evolución posterior y no se presentan como terminados.

## Benchmark aplicado — card issuing (29/08/2026)

[Pismo documenta](https://developers.pismo.io/pismo-docs/docs/card-lifecycle-and-statuses) un ciclo de vida explícito con estados iniciales distintos para instrumentos físicos y virtuales, bloqueos temporales y estados terminales; sus [Flex Controls](https://developers.pismo.io/pismo-docs/docs/flex-controls) modelan límites y restricciones por cuenta, cliente o tarjeta y publican cambios asíncronos. [Pomelo](https://developers.pomelo.la/api-reference/cards/issuing/create-card) exige idempotencia al crear, expone activación y actualización de estado por API, mantiene paridad operativa con su dashboard y publica [eventos de tarjetas](https://developers.pomelo.la/api-reference/cards/issuing/card-events). Su operación PCI separa además la recuperación de datos sensibles del recurso ordinario.

Cimbra adopta el patrón competitivo como contrato propio: programas tenant-scoped; instrumentos debit/credit/prepaid físicos o virtuales; lifecycle append-only con transición, razón y actor; `terminated` irreversible; controles completos versionados con límites en unidades mínimas, canales y MCC; locks, idempotencia, RBAC, scopes, auditoría, webhooks, SDK y consola. No replica contratos ni se conecta con esas plataformas. La decisión deliberada es más restrictiva en esta etapa: el sandbox nunca genera ni retorna PAN/CVV y los controles no se presentan como aplicados en red. Tokenización, HSM, ISO 8583, personalización, autorización y clearing pasan al gate PCI/esquema/sponsor, no a una simulación decorativa.

## Benchmark aplicado — doble aprobación (29/08/2026)

Pismo publica un patrón maker/checker en el que una persona solicita, otra con rol autorizado decide y la operación no cambia el recurso hasta la aprobación; también documenta estados pendientes y terminales, expiración, historial y notificaciones para operaciones sensibles. BIND/bindX documenta OAuth 2.0 y permisos robustos para transferencias automatizadas, pero su material público consultado no alcanza para atribuirle un contrato maker/checker equivalente. No se encontraron contratos públicos suficientemente precisos de Dock, tapi, Pomelo o Wibond para afirmar paridad de doble aprobación endpoint por endpoint.

Cimbra implementa el patrón como propiedad propia para settlement, transferencias salientes sandbox, casos de riesgo y excepciones de conciliación: políticas independientes por tenant, maker y checker distintos, owner/admin con MFA para decidir, idempotencia, locks compartidos/exclusivos, expiración, rechazo, cancelación, fallo, auditoría, webhooks y ejecución atómica. El scheduler atraviesa el mismo control. Una transferencia pendiente no reserva fondos; un caso o una excepción permanecen abiertos; al aprobar se revalida el estado y recién entonces se actualizan ledger, hold o cierre operativo. Las integraciones S2S pueden originar una acción protegida y leer el historial con los scopes correspondientes, pero no aprobar ni rechazar. A diferencia del fallback documentado por Pismo ante ciertos fallos de su workflow, Cimbra falla cerrado y nunca ejecuta fuera de la política. Pismo mantiene hoy mayor cobertura —límites, tarjetas, credenciales, configuración y lending—; esas acciones, notificaciones específicas y un rol approver dedicado permanecen en el roadmap propio de Cimbra.

## Benchmark aplicado — case operations (29/08/2026)

Pismo expone historial y notas de acciones operativas, perfiles RBAC y navegación por estados; Pomelo modela remedies/chargebacks como expedientes vinculados a una transacción y admite archivos; Dock destaca workflows, alertas y comunicación bidireccional en fraude. El patrón común útil no es copiar pantallas: es hacer visible quién posee el caso, cuándo vence, qué evidencia sustenta la decisión y qué cambió.

Cimbra implementa esa capa como proyección propia sobre `risk_cases` y `reconciliation_exceptions`: cola unificada, responsable validado contra la membresía del tenant, prioridad, SLA inicial, escalamiento, comentarios append-only y evidencia enlazada desde almacenamiento privado. API v1, SDK, consola, scopes, RBAC, idempotencia, auditoría y webhooks comparten el mismo contrato. Las resoluciones siguen en los módulos de dominio existentes y ahora pueden quedar protegidas por políticas maker/checker independientes: el recurso permanece abierto hasta la aprobación, el checker revalida y ejecuta en la misma transacción y un hold vinculado no admite bypass mientras la política está activa.

## Benchmark aplicado — narrativa comercial y acceso developer (29/08/2026)

Las superficies públicas de Pismo y Dock priorizan una promesa modular, una integración y amplitud de plataforma; tapi conecta esa promesa con casos de uso, sandbox y portal developer; Pomelo separa con claridad issuing, processing, sponsorship y requisitos de certificación; BIND PSP distingue staging/producción, OAuth 2.0 y permisos por scope. Cimbra adopta esos patrones de comprensión, no sus marcas ni contratos: hero orientado al resultado, catálogo modular con estado verificable, casos de uso por comprador, arquitectura de una integración, prueba técnica, documentación y CTA contextual.

La decisión propia es no fingir clientes, volumen, uptime, tiempos de integración ni conectividad. La landing usa evidencia que existe en el repositorio —API v1, OpenAPI, SDK, ledger, RBAC, maker/checker y webhooks— y etiqueta sandbox, foundation y roadmap. Los plazos comerciales se expresan como gates de fit, build, homologación y operación; producción sólo se presenta después de riel, contrato, licencia o sponsor, certificación, SLO y runbooks. El estado de sesión también es real: una persona autenticada abre su consola y una anónima ingresa o solicita una sesión de diseño.

## Benchmark aplicado — developer experience verificable (29/08/2026)

Pismo reúne guías, referencia REST, esquemas de eventos, changelog, consola interactiva y colección Postman; además documenta autenticación S2S y verificación de webhooks como contratos separados. Pomelo hace explícitos OAuth 2.0, scopes, montos decimales, idempotencia y firma HMAC de webhooks. BIND PSP publica URLs distintas para staging y producción, autenticación, scopes, ejemplos curl, códigos de error y política de reintentos de webhooks. Esos patrones reducen el tiempo hasta el primer request y, sobre todo, evitan que el integrador tenga que adivinar límites operativos.

Cimbra adopta el estándar de claridad como propiedad propia: `/developers` publica la única base URL activa, diferencia sandbox de producción no habilitada, genera la referencia de 78 operaciones desde OpenAPI, consume scopes y eventos canónicos, ofrece quickstarts exactos, errores estructurados, rate limits, paginación, modelo monetario, contrato de firma y calendario de reintentos. El SDK TypeScript se distribuye como artefacto real con checksum mientras no exista publicación npm. Postman y SDKs adicionales se muestran explícitamente como backlog; no se ofrecen botones ni instalaciones ficticias. La consola interactiva contra endpoints mutantes se posterga hasta poder aislar credenciales y datos de forma segura. Dock, tapi y Wibond continúan como benchmarks de producto; no se atribuyen contratos técnicos específicos cuando la documentación pública consultada no alcanza para verificarlos.

## Wedge recomendado

Primer segmento: marketplaces, SaaS vertical y plataformas de workforce con volumen mensual entre USD 1M y USD 20M que necesitan cuentas virtuales, payouts, conciliación y tarjetas corporativas en Argentina y México.

Primer paquete vendible:

- ledger y cuentas virtuales;
- incoming payments y payouts;
- conciliación automática;
- KYB/KYC orquestado;
- consola operativa y webhooks;
- conectividad directa al riel inicial y contingencia operativa certificada.

Lending, acquiring y procesamiento profundo permanecen en el roadmap hasta validar distribución; siguen siendo producto futuro de Cimbra, no integraciones con esas plataformas.

## Modelo comercial

- fee de implementación por complejidad y jurisdicción;
- plataforma mensual por entorno, soporte y módulos;
- fee por cuenta activa o tarjeta activa;
- fee por transacción o basis points según riel;
- mínimos mensuales para cubrir soporte, compliance, redes, sponsors e infraestructura;
- pricing enterprise con SLA, residencia, reporting y soporte dedicados.

No subsidiar volumen indefinidamente. Cada contrato debe modelar margen de contribución por riel, costo de fondos, fraude, soporte, chargebacks, network/sponsor fees y costo regulatorio.

## Métricas de dirección

Producto: tiempo a primer request, tiempo a homologación, tasa de éxito, latencia, reintentos, errores por integración y adopción de módulos.

Operación: diferencias de conciliación, antigüedad de excepciones, falsos positivos, tiempo de resolución y pérdida por fraude.

Negocio: ARR, revenue retention, margen bruto por cliente, payback CAC, concentración, pipeline ponderado y burn multiple.

Riesgo: fondos no conciliados, exposición por sponsor/red, incidentes, hallazgos vencidos y cumplimiento de SLO.

## Objetivo de inversión

Una ronda pre-seed debe financiar 18 meses para cerrar el producto inicial, contratar seguridad/compliance, homologar dos rieles por mercado, ejecutar pilotos pagos y demostrar margen bruto defendible. Los hitos deben ser contratos y volumen conciliado, no sólo APIs construidas.

## Fuentes competitivas consultadas

- https://www.bindx.com/
- https://psp.bind.com.ar/developers
- https://psp.bind.com.ar/developers/general
- https://developers.bindx.com/transferencias-online-bind
- https://developers.bindx.com/consulta-de-cuentas-bind
- https://dock.tech/es/
- https://www.dock.tech/en/dock-one/
- https://dock.tech/es/solucao/fraud-prevention/
- https://www.dock.tech/en/solution/fraud-prevention
- https://tapi.la/
- https://www.tapila.dev/docs
- https://developers.pismo.io/pismo-docs/docs/welcome
- https://www.pismo.io/homepage/
- https://developers.pismo.io/pismo-docs/docs/main-solutions
- https://developers.pismo.io/pismo-docs/docs/anti-fraud-integration
- https://developers.pismo.io/pismo-docs/docs/authorization-validation-rules-for-platform-operations
- https://developers.pismo.io/pismo-docs/docs/disputes
- https://developers.pismo.io/pismo-docs/docs/security-guide-for-apis
- https://developers.pismo.io/pismo-docs/docs/security
- https://developers.pismo.io/pismo-docs/docs/verifying-webhook-requests
- https://developers.pismo.io/pismo-docs/docs/get-started-with-sso-for-control-center
- https://developers.pismo.io/pismo-docs/docs/security-guide-for-control-center
- https://developers.pismo.io/pismo-docs/docs/control-center-access-profiles-and-roles
- https://developers.pismo.io/pismo-docs/docs/dual-approval
- https://developers.pismo.io/pismo-docs/docs/account-actions
- https://developers.pismo.io/pismo-docs/docs/control-center-navigation
- https://developers.pismo.io/pismo-docs/docs/card-lifecycle-and-statuses
- https://developers.pismo.io/pismo-docs/docs/flex-controls
- https://developers.pismo.io/pismo-docs/reference/post-v1-accounts-flex-controls
- https://developers.pomelo.la/api-reference/fraud/remedies/tx-remedy
- https://developers.pomelo.la/api-reference/fraud/transactional-block/get-block-status
- https://developers.pomelo.la/en/api-reference/fraud-prevention/chargebacks
- https://developers.pomelo.la/en/api-reference/Identity/kyc
- https://developers.pismo.io/pismo-docs/changelog/6-march-2026
- https://developers.pismo.io/pismo-docs/docs/file-based-check-processing-and-bulk-settlement
- https://developers.pomelo.la/api-reference/processing/transactions
- https://developers.pomelo.la/api-reference/home/auth
- https://developers.pomelo.la/api-reference/get-started/idempotency
- https://developers.pomelo.la/api-reference/Identity/webhooks
- https://www.pomelo.la/es/
- https://docs.pomelo.la/en/docs/cards/processing/reports/download-report
- https://developers.pomelo.la/guides/solutions/processing/reports
- https://developers.pomelo.la/api-reference/fraud/remedies/tx-remedy
- https://developers.pomelo.la/en/api-reference/fraud-prevention/chargebacks
- https://developers.pomelo.la/guides/dashboard/company/administration
- https://developers.pomelo.la/api-reference/cards/issuing/create-card
- https://developers.pomelo.la/api-reference/cards/issuing/update-card
- https://developers.pomelo.la/api-reference/cards/issuing/card-events
- https://developers.pomelo.la/guides/dashboard/cards/cards
- https://developers.pomelo.la/api-reference/cards/issuing/get-card
- https://www.wibond.co/

La información pública cambia; validar métricas, cobertura, licencias y precios directamente en diligence antes de usarla en un pitch.
